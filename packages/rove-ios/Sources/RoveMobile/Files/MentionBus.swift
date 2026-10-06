import SwiftUI
import Observation

/// F6: put `@path` into the engine's input WITHOUT submitting. The terminal session behind the
/// task detail detaches while the files screen is on top, so a mention is parked here and typed
/// once the session is attached again and live — never while the replay is still being fed.
@MainActor @Observable
final class MentionBus {
    static let shared = MentionBus()
    struct Pending: Equatable { var taskId: String; var text: String }
    private(set) var pending: Pending?

    /// The TUI's exact form: `@<worktree-relative path>`, no trailing space, no submit.
    static func text(for path: String) -> String { "@" + path }

    func post(taskId: String, path: String) { pending = Pending(taskId: taskId, text: Self.text(for: path)) }

    /// Hands the parked mention to `deliver` only for the matching task; clears it once taken.
    func take(taskId: String) -> String? {
        guard let p = pending, p.taskId == taskId else { return nil }
        pending = nil
        return p.text
    }
}

private struct MentionDelivery: ViewModifier {
    let taskId: String
    let session: TerminalSession?
    var bus = MentionBus.shared
    /// The session keeps a stale "Live" while detached, so only a live status that FOLLOWS an
    /// "attaching" one proves the stream is attached again (and the replay has been fed).
    @State private var sawAttaching = false

    func body(content: Content) -> some View {
        content
            .onChange(of: bus.pending) { sawAttaching = false }
            .onChange(of: session?.status) { _, status in
                guard bus.pending?.taskId == taskId else { return }
                if status == TerminalSession.attachingStatus { sawAttaching = true; return }
                guard sawAttaching, status == TerminalSession.liveStatus, let session, !session.exited,
                      let text = bus.take(taskId: taskId) else { return }
                sawAttaching = false
                session.typed(Array(text.utf8))
            }
    }
}

extension View {
    /// Types a mention parked by the files screen into this task's terminal once it is live.
    func mentionDelivery(taskId: String, session: TerminalSession?) -> some View {
        modifier(MentionDelivery(taskId: taskId, session: session))
    }
}
