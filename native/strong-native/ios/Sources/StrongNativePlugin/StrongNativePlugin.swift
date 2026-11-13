import AVFoundation
import AudioToolbox
import Capacitor
import UIKit
import UserNotifications

/// What the web app can't do on an iPhone by itself (see src/lib/native.ts): the end-of-rest ping,
/// which also sounds in silent mode and only lowers the podcast for a moment, ringing it when the
/// rest is over with the iPhone locked or in another app, the same ping for the rest notifications,
/// the rest on the lock screen and in the Dynamic Island (LiveRest), and keeping the screen on
/// during a workout.
@objc(StrongNativePlugin)
public class StrongNativePlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    public let identifier = "StrongNativePlugin"
    public let jsName = "StrongNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ping", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ringAt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise)
    ]

    /// The rest notification: its id in src/lib/localNotifications.ts.
    private static let restNotification = "1"
    /// How early the app rings before the rest notification would: time to take its sound away.
    private static let early: TimeInterval = 0.3
    /// A ping asked for this soon after the app rang by itself is for the same rest (see ping).
    private static let sameRest: TimeInterval = 3

    /// The ping, made by the web app's build (src/lib/ping.ts) and copied into the app with it.
    private let pingFile = Bundle.main.url(forResource: "ping", withExtension: "wav", subdirectory: "public/sounds")
    /// The ping while it sounds.
    private var player: AVAudioPlayer?
    /// Silence played during a rest, which keeps the app running in the background (see ringAt).
    private var silence: AVAudioPlayer?
    /// When the current rest ends (nil: no rest, or it isn't to be rung).
    private var endsAt: Date?
    private var timer: DispatchSourceTimer?
    /// When the app last rang by itself at the end of a rest.
    private var rungAt: Date?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    override public func load() {
        installNotificationSound()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(audioInterrupted(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance())
        // The iOS workflow (.github/workflows/ios.yml) opens the app in the simulator this way: a
        // rest of a minute once the page has loaded, to see it in the Dynamic Island and hear its
        // end with the app in the background.
        if ProcessInfo.processInfo.arguments.contains("-descansoDePrueba") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
                self.tryRest()
            }
        }
    }

    private func tryRest() {
        let endsAt = Date().addingTimeInterval(60)
        arm(endsAt)
        if #available(iOS 16.2, *) {
            Task {
                await LiveRest.show(RestAttributes.ContentState(
                    startedAt: Date(), endsAt: endsAt, exercise: "Press de banca (barra)",
                    detail: "60 kg × 8 · serie 2 de 3", over: false))
            }
        }
    }

    /// iOS looks for notification sounds in Library/Sounds: the rest notification asks for ping.wav
    /// (src/lib/localNotifications.ts). Copied every time the app opens, so it is always this version's.
    private func installNotificationSound() {
        guard let pingFile else {
            CAPLog.print("[error] StrongNative: no está public/sounds/ping.wav en la app")
            return
        }
        do {
            let files = FileManager.default
            let sounds = try files.url(for: .libraryDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("Sounds", isDirectory: true)
            try files.createDirectory(at: sounds, withIntermediateDirectories: true)
            let target = sounds.appendingPathComponent("ping.wav")
            if files.fileExists(atPath: target.path) {
                try files.removeItem(at: target)
            }
            try files.copyItem(at: pingFile, to: target)
            CAPLog.print("StrongNative: sonido de los avisos listo")
        } catch {
            CAPLog.print("[error] StrongNative: no se pudo preparar el sonido de los avisos: \(error)")
        }
    }

    /// Plays the ping (the web app asks for it when the rest is over with the app on screen, and to
    /// try it), unless the app has just rung by itself for the same rest.
    @objc func ping(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let rungAt = self.rungAt, Date().timeIntervalSince(rungAt) < Self.sameRest {
                call.resolve()
                return
            }
            do {
                try self.play()
                call.resolve()
            } catch {
                self.release()
                call.reject("No se pudo hacer sonar el ping", nil, error)
            }
        }
    }

    private enum PingError: Error {
        case noFile
        case didNotPlay
    }

    /// Playback audio sounds also with the iPhone in silent mode; ducking others plays the ping
    /// over the podcast or the music, which keep playing lower while it sounds (they aren't paused)
    /// and get their volume back when it is over (see release). iOS lowers them when the app's audio
    /// becomes active, so the rest's silence, which has it active already, stops first.
    private func play() throws {
        guard let pingFile else { throw PingError.noFile }
        let session = AVAudioSession.sharedInstance()
        if silence?.isPlaying == true {
            silence?.stop()
            try? session.setActive(false)
        }
        try session.setCategory(.playback, mode: .default, options: [.duckOthers])
        try session.setActive(true)
        let player = try AVAudioPlayer(contentsOf: pingFile)
        player.delegate = self
        self.player = player
        guard player.play() else { throw PingError.didNotPlay }
    }

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async {
            if player === self.player {
                self.release()
            }
        }
    }

    public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        DispatchQueue.main.async {
            if player === self.player {
                self.release()
            }
        }
    }

    /// Lets go of the audio after the ping: the podcast or the music go back to their volume. If a
    /// new rest has started meanwhile, its silence plays again.
    private func release() {
        player = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if endsAt != nil {
            startSilence()
        }
        endBackgroundTask()
    }

    /// Rings the ping when the rest ends, at `endsAt` (ms since 1970; null: no rest now), if the app
    /// isn't on screen then: with the iPhone locked or in another app. iOS keeps an app running in
    /// the background while it plays audio (UIBackgroundModes audio, in Info.plist), so during the
    /// rest the app plays silence, mixed with the podcast or the music without changing them. With the
    /// app on screen the web app rings by itself (useRestAlarm in src/lib/restTimer.ts).
    @objc func ringAt(_ call: CAPPluginCall) {
        let endsAt = call.getDouble("endsAt").map { Date(timeIntervalSince1970: $0 / 1000) }
        DispatchQueue.main.async {
            self.arm(endsAt)
            call.resolve()
        }
    }

    private func arm(_ endsAt: Date?) {
        timer?.cancel()
        timer = nil
        guard let endsAt, endsAt.timeIntervalSinceNow > 0 else {
            self.endsAt = nil
            stopSilence()
            return
        }
        self.endsAt = endsAt
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(wallDeadline: .now() + max(0, endsAt.timeIntervalSinceNow - Self.early), leeway: .milliseconds(10))
        timer.setEventHandler { [weak self] in
            self?.restIsOver()
        }
        timer.resume()
        self.timer = timer
        startSilence()
    }

    /// The end of the rest. With the app on screen the web app rings. Otherwise the app rings and
    /// vibrates, and the rest notification still shows but without its sound, which would be the
    /// ping a second time (and wouldn't sound in silent mode). If the app can't ring, the
    /// notification rings as it is.
    private func restIsOver() {
        timer?.cancel()
        timer = nil
        guard let endsAt else { return }
        self.endsAt = nil
        if #available(iOS 16.2, *) {
            Task {
                await LiveRest.restIsOver()
            }
        }
        // Long after the end (the app was stopped meanwhile), the notification has rung already.
        let late = Date().timeIntervalSince(endsAt) > Self.sameRest
        if UIApplication.shared.applicationState == .active || late {
            stopSilence()
            return
        }
        beginBackgroundTask()
        do {
            try play()
        } catch {
            CAPLog.print("[error] StrongNative: no sonó el final del descanso: \(error)")
            release()
            return
        }
        rungAt = Date()
        silenceRestNotification()
        vibrate()
        CAPLog.print("StrongNative: final del descanso sonado con la app en segundo plano")
    }

    /// Shows the rest on the lock screen and in the Dynamic Island, from `startedAt` to `endsAt` (ms
    /// since 1970), with the next set (`exercise` and `detail`); with `endsAt` null it goes away.
    /// Needs iOS 16.2 (before, it does nothing), and Live Activities allowed for the app (iPhone
    /// Settings → Strong 2.0).
    @objc func restActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        let date = { (key: String) in call.getDouble(key).map { Date(timeIntervalSince1970: $0 / 1000) } }
        let endsAt = date("endsAt")
        let startedAt = date("startedAt")
        let exercise = call.getString("exercise")
        let detail = call.getString("detail")
        Task {
            if let endsAt {
                await LiveRest.show(RestAttributes.ContentState(
                    startedAt: min(startedAt ?? endsAt, endsAt), endsAt: endsAt, exercise: exercise,
                    detail: detail, over: endsAt <= Date()))
            } else {
                await LiveRest.end()
            }
            call.resolve()
        }
    }

    /// Replaces the rest notification, still to come, with the same one now and without sound.
    private func silenceRestNotification() {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            guard let request = requests.first(where: { $0.identifier == Self.restNotification }),
                  let content = request.content.mutableCopy() as? UNMutableNotificationContent
            else { return }
            center.removePendingNotificationRequests(withIdentifiers: [Self.restNotification])
            content.sound = nil
            center.add(UNNotificationRequest(identifier: Self.restNotification, content: content, trigger: nil))
        }
    }

    /// Two vibrations, as when the rest is over with the app on screen (signalRestOver in src/lib/sound.ts).
    private func vibrate() {
        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        }
    }

    /// Plays silence in a loop, mixed with whatever else is playing. While the ping sounds it waits:
    /// release starts it afterwards.
    private func startSilence() {
        guard player == nil else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
            if silence == nil {
                let silence = try AVAudioPlayer(data: Self.silentWav, fileTypeHint: AVFileType.wav.rawValue)
                silence.numberOfLoops = -1
                self.silence = silence
            }
            silence?.play()
        } catch {
            CAPLog.print("StrongNative: sin audio de fondo, el final del descanso lo avisa la notificación: \(error)")
        }
    }

    private func stopSilence() {
        guard let silence, silence.isPlaying else { return }
        silence.stop()
        if player == nil {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    /// Half a second of silence as a WAV file: 16-bit mono PCM at 8 kHz.
    private static let silentWav: Data = {
        let rate: UInt32 = 8000
        let bytes = rate  // half a second, two bytes per sample
        var wav = Data()
        func text(_ value: String) {
            wav.append(contentsOf: Array(value.utf8))
        }
        func number<T: FixedWidthInteger>(_ value: T) {
            withUnsafeBytes(of: value.littleEndian) { wav.append(contentsOf: $0) }
        }
        text("RIFF")
        number(UInt32(36) + bytes)
        text("WAVE")
        text("fmt ")
        number(UInt32(16))  // size of this chunk
        number(UInt16(1))  // PCM
        number(UInt16(1))  // mono
        number(rate)
        number(rate * 2)  // bytes per second
        number(UInt16(2))  // bytes per sample
        number(UInt16(16))  // bits per sample
        text("data")
        number(bytes)
        wav.append(Data(count: Int(bytes)))
        return wav
    }()

    /// A call or an alarm stops the app's audio: the ping is left there, and the rest's silence plays
    /// again when they are over. Meanwhile iOS may stop the app, and then the notification rings.
    @objc private func audioInterrupted(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        DispatchQueue.main.async {
            switch type {
            case .began:
                if let player = self.player {
                    player.stop()
                    self.release()
                }
            case .ended:
                if self.endsAt != nil {
                    self.startSilence()
                }
            @unknown default:
                break
            }
        }
    }

    /// Time to ring in the background: from the rest's silence to the end of the ping.
    private func beginBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Final del descanso") { [weak self] in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    /// Keeps the screen on (`on: true`) or lets the iPhone lock by itself again.
    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }
}
