import Observation
import SwiftUI

/// `tab.send`'s answer: taken now, held for the end of the turn, or neither with a reason.
struct EngineSendReply: Decodable, Equatable {
    var delivered = false
    var queued = false
    var position: Int?
    var reason: String?

    init(delivered: Bool) { self.delivered = delivered }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        delivered = try c.decodeIfPresent(Bool.self, forKey: .delivered) ?? false
        queued = try c.decodeIfPresent(Bool.self, forKey: .queued) ?? false
        position = try c.decodeIfPresent(Int.self, forKey: .position)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
    }
    enum CodingKeys: String, CodingKey { case delivered, queued, position, reason }
}

struct HeldPrompt: Decodable, Identifiable, Equatable {
    var id: String
    var tabId: String
    var text: String
}

struct HeldPromptList: Decodable {
    var items: [HeldPrompt]
}

/// The messages the daemon holds for one tab, in the order it will paste them: one per finished turn.
@MainActor @Observable
final class HeldPrompts {
    private(set) var items: [HeldPrompt] = []
    /// Held prompts change on turn ends, not keystrokes.
    private static let pollSeconds = 3.0

    func poll(session: TerminalSession) async {
        while !Task.isCancelled {
            await load(session: session)
            try? await Task.sleep(for: .seconds(Self.pollSeconds))
        }
    }

    func load(session: TerminalSession) async {
        // A bridge older than the queue has no `queue.list`: nothing is ever held there.
        let all = (try? await session.client.request("queue.list", ["taskId": session.taskId], as: HeldPromptList.self))?.items
        items = (all ?? []).filter { $0.tabId == session.tabId }
    }

    func cancel(_ id: String, session: TerminalSession) async {
        _ = try? await session.client.request("queue.cancel", ["id": id])
        await load(session: session)
    }
}

/// One chip per held message above the composer; its × takes the message back.
struct HeldPromptChips: View {
    var session: TerminalSession
    var queue: HeldPrompts

    var body: some View {
        if !queue.items.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(queue.items) { item in
                        HStack(spacing: 6) {
                            Text("queued · \(item.text)")
                                .font(Theme.mono(12))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .frame(maxWidth: 240, alignment: .leading)
                            Button { Task { await queue.cancel(item.id, session: session) } } label: {
                                Text(verbatim: "×").font(Theme.mono(14, .medium)).foregroundStyle(Theme.muted)
                                    .frame(width: 28, height: 32)
                            }
                            .buttonStyle(.pressable)
                            .accessibilityLabel("Take back")
                            .accessibilityIdentifier("heldCancel-\(item.id)")
                        }
                        .padding(.leading, 10)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Theme.line))
                    }
                }
                .padding(.horizontal, 12)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("heldPrompts")
        }
    }
}
