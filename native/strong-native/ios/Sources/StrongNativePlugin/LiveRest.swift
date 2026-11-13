import ActivityKit
import Capacitor
import Foundation

/// The rest on the lock screen and in the Dynamic Island (RestAttributes, drawn by the widget
/// extension in ios/App/RestActivity). There is one at a time: each rest changes the one there is,
/// so it doesn't go away and come back between sets. It ends with the workout (see
/// src/lib/liveActivity.ts).
///
/// Without a paid developer account there are no pushes, so only the app changes it: while it
/// runs, also in the background during a rest (see StrongNativePlugin.ringAt).
@available(iOS 16.2, *)
enum LiveRest {
    /// Shows `state`, starting the activity if there isn't one (only with the app on screen).
    @MainActor
    static func show(_ state: RestAttributes.ContentState) async {
        // Out of date at the end of the rest: drawn as over even if the app can't say so then.
        let content = ActivityContent(state: state, staleDate: state.over ? nil : state.endsAt)
        var activities = Activity<RestAttributes>.activities
        if activities.isEmpty {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            do {
                _ = try Activity.request(attributes: RestAttributes(), content: content, pushType: nil)
                CAPLog.print("StrongNative: descanso en la pantalla de bloqueo")
            } catch {
                CAPLog.print("StrongNative: no se pudo mostrar el descanso en la pantalla de bloqueo: \(error)")
            }
            return
        }
        let current = activities.removeFirst()
        await current.update(content)
        for other in activities {
            await other.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// The rest is over: it says so until the next rest starts or the workout ends.
    @MainActor
    static func restIsOver() async {
        for activity in Activity<RestAttributes>.activities {
            var state = activity.content.state
            state.over = true
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
    }

    /// Takes it away.
    @MainActor
    static func end() async {
        for activity in Activity<RestAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
