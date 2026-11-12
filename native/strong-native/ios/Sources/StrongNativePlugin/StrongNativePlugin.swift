import AVFoundation
import Capacitor
import UIKit

/// What the web app can't do on an iPhone by itself (see src/lib/native.ts): the end-of-rest ping,
/// which also sounds in silent mode and only lowers the podcast for a moment, the same ping for the
/// rest notifications, and keeping the screen on during a workout.
@objc(StrongNativePlugin)
public class StrongNativePlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    public let identifier = "StrongNativePlugin"
    public let jsName = "StrongNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ping", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise)
    ]

    /// The ping, made by the web app's build (src/lib/ping.ts) and copied into the app with it.
    private let pingFile = Bundle.main.url(forResource: "ping", withExtension: "wav", subdirectory: "public/sounds")
    private var player: AVAudioPlayer?

    override public func load() {
        installNotificationSound()
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

    /// Plays the ping. Playback audio sounds also with the iPhone in silent mode; ducking others
    /// plays it over the podcast or the music, which keep playing lower while it sounds (they aren't
    /// paused), and get their volume back when it is over (see release).
    @objc func ping(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let pingFile = self.pingFile else {
                call.reject("No está el sonido del ping")
                return
            }
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .default, options: [.duckOthers])
                try session.setActive(true)
                let player = try AVAudioPlayer(contentsOf: pingFile)
                player.delegate = self
                self.player = player
                player.play()
                call.resolve()
            } catch {
                self.release()
                call.reject("No se pudo hacer sonar el ping", nil, error)
            }
        }
    }

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if player === self.player {
            release()
        }
    }

    public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        if player === self.player {
            release()
        }
    }

    /// Lets go of the audio: the podcast or the music go back to their volume.
    private func release() {
        player = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
