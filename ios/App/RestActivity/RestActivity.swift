import ActivityKit
import OSLog
import SwiftUI
import WidgetKit

/// The rest on the lock screen and in the Dynamic Island: a Live Activity (RestAttributes), which the
/// app starts and changes (native/strong-native, LiveRest). A countdown, a bar that empties and the
/// next set; when the rest is over, «Descanso terminado» and the next set. A tap opens the app.
@main
struct RestWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestAttributes.self) { context in
            LockScreen(rest: Rest(context))
                .activityBackgroundTint(Color.black.opacity(0.75))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let rest = Rest(context)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Title(rest: rest, text: rest.over ? "Terminado" : "Descanso")
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if !rest.over {
                        Countdown(rest: rest)
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(width: 84, alignment: .trailing)
                            .padding(.trailing, 6)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        if !rest.over {
                            Bar(rest: rest)
                        }
                        NextSet(rest: rest)
                    }
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                Image(systemName: rest.symbol)
                    .foregroundStyle(accent)
            } compactTrailing: {
                if rest.over {
                    Text("Fin")
                        .font(.headline)
                        .foregroundStyle(accent)
                } else {
                    Countdown(rest: rest)
                        .foregroundStyle(.white)
                        .frame(width: 44, alignment: .trailing)
                }
            } minimal: {
                Image(systemName: rest.symbol)
                    .foregroundStyle(accent)
            }
            .keylineTint(accent)
        }
    }
}

private let log = Logger(subsystem: "io.github.puertamillet.strong2.RestActivity", category: "rest")

/// The app's blue (--accent in src/index.css, dark mode).
private let accent = Color(red: 0x3d / 255, green: 0x9b / 255, blue: 1)

/// What is drawn of a rest.
struct Rest {
    let state: RestAttributes.ContentState
    /// The app said so when it rang, or its end has passed (iOS marks the activity out of date then,
    /// for when the app couldn't say so; not believed before the end).
    let over: Bool

    init(_ context: ActivityViewContext<RestAttributes>) {
        state = context.state
        over = context.state.over || (context.isStale && context.state.endsAt <= Date())
        log.notice(
            "RestActivity: over \(context.state.over, privacy: .public) stale \(context.isStale, privacy: .public) ends in \(context.state.endsAt.timeIntervalSinceNow, privacy: .public)")
    }

    var interval: ClosedRange<Date> {
        min(state.startedAt, state.endsAt)...state.endsAt
    }

    var symbol: String {
        over ? "checkmark.circle.fill" : "timer"
    }
}

struct LockScreen: View {
    let rest: Rest

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                Title(rest: rest, text: rest.over ? "Descanso terminado" : "Descanso")
                Spacer(minLength: 8)
                if !rest.over {
                    Countdown(rest: rest)
                        .font(.title.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 100, alignment: .trailing)
                }
            }
            if !rest.over {
                Bar(rest: rest)
            }
            NextSet(rest: rest)
        }
        .padding(16)
    }
}

struct Title: View {
    let rest: Rest
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: rest.symbol)
                .foregroundStyle(accent)
            Text(text)
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .font(.headline)
    }
}

/// «1:58», counting down to the end of the rest (iOS keeps it going without the app).
struct Countdown: View {
    let rest: Rest

    var body: some View {
        Text(timerInterval: rest.interval, countsDown: true)
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
    }
}

/// A bar that empties until the end of the rest, as the app's.
struct Bar: View {
    let rest: Rest

    var body: some View {
        ProgressView(timerInterval: rest.interval, countsDown: true) {
            EmptyView()
        } currentValueLabel: {
            EmptyView()
        }
        .progressViewStyle(.linear)
        .tint(accent)
    }
}

/// «Siguiente: Press de banca (barra)» and «60 kg × 8 · serie 2 de 3».
struct NextSet: View {
    let rest: Rest

    var body: some View {
        if let exercise = rest.state.exercise {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: "Siguiente: \(exercise)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                if let detail = rest.state.detail {
                    Text(verbatim: detail)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
