import ActivityKit
import Foundation

/// A rest on the lock screen and in the Dynamic Island: a Live Activity. The app starts it and
/// changes it (StrongNativePlugin, LiveRest), and the widget extension in ios/App/RestActivity
/// draws it. Both build this same file: iOS tells which activity is which by this type's name.
@available(iOS 16.1, *)
public struct RestAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// When the rest started, and when it ends.
        public var startedAt: Date
        public var endsAt: Date
        /// The next set: its exercise («Press de banca (barra)») and the rest of it («60 kg × 8 · serie
        /// 2 de 3»). Nil if there is none.
        public var exercise: String?
        public var detail: String?
        /// The rest is over. The app says so when it rings; before that, iOS shows the activity as
        /// out of date once endsAt has passed, which the extension draws the same.
        public var over: Bool

        public init(startedAt: Date, endsAt: Date, exercise: String?, detail: String?, over: Bool) {
            self.startedAt = startedAt
            self.endsAt = endsAt
            self.exercise = exercise
            self.detail = detail
            self.over = over
        }
    }

    public init() {}
}
