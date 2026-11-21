import SwiftUI

/// What a peek under an Inbox row lets you do with the tab without opening it.
enum PeekMode: Equatable {
    /// A message rides `tab.send`, which queues behind a busy turn itself.
    case reply
    /// The engine is at a menu: keys, never a paste.
    case menu
    /// The tab is gone: its last lines only.
    case readonly
}

struct TerminalTailResult: Decodable {
    struct Terminal: Decodable { var tail: [String]? }
    var terminal: Terminal?
}

/// The tab's last lines, a reply field or menu keys, in place under its Inbox row (web `inbox-peek.tsx`).
struct InboxPeek: View {
    let taskId: String
    let tabId: String
    let mode: PeekMode
    var openTab: () -> Void
    @Environment(AppModel.self) private var model
    @State private var lines: [String]?
    @State private var text = ""
    @State private var busy = false
    @State private var note: String?

    static let menuKeys: [(cap: String, bytes: String)] = [("1", "1"), ("2", "2"), ("3", "3"), ("esc", "\u{1b}"), ("enter", "\r")]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView {
                Text(lines.map { $0.isEmpty ? String(localized: "no output yet") : $0.joined(separator: "\n") } ?? "…")
                    .font(Theme.mono(11)).foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .defaultScrollAnchor(.bottom)
            .frame(maxHeight: 180)
            .padding(8)
            .background(Theme.inset, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
            .accessibilityIdentifier("peekTail")
            if let note { Text(note).font(Theme.mono(11)).foregroundStyle(Theme.error) }
            switch mode {
            case .reply:
                HStack(spacing: 8) {
                    FieldBox {
                        TextField("reply to this session", text: $text)
                            .submitLabel(.send).onSubmit { Task { await send() } }
                            .accessibilityIdentifier("peekField")
                    }
                    Button { Task { await send() } } label: { TileLabel(text: String(localized: "send"), tint: Theme.accent, size: 12) }
                        .buttonStyle(.pressable).disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("peekSend")
                }
            case .menu:
                HStack(spacing: 6) {
                    ForEach(Self.menuKeys, id: \.cap) { key in
                        Button { Task { await press(key.bytes) } } label: { TileLabel(text: key.cap, tint: Theme.ink, size: 12) }
                            .buttonStyle(.pressable).disabled(busy)
                            .accessibilityIdentifier("peekKey-\(key.cap)")
                    }
                    Spacer(minLength: 0)
                    Button(action: openTab) { Text("open tab").font(Theme.mono(12)).foregroundStyle(Theme.accent) }
                        .buttonStyle(.pressable)
                }
            case .readonly:
                EmptyView()
            }
        }
        .padding(.horizontal, 20).padding(.bottom, 10)
        .task { await readTail() }
    }

    /// The terminal screen, not the transcript: a menu is on the screen and never in the history.
    private func readTail() async {
        let r = try? await model.client.request(
            "output.read", ["taskId": taskId, "tab": tabId, "source": "terminal", "limit": InboxLogic.peekLines], as: TerminalTailResult.self)
        lines = InboxLogic.tail(r?.terminal?.tail ?? [])
    }

    private func send() async {
        let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !busy else { return }
        await run {
            let r = try await model.client.request("tab.send", ["taskId": taskId, "tabId": tabId, "prompt": prompt], as: EngineSendReply.self)
            guard r.delivered || r.queued else { throw BridgeError(code: "NOT_SENT", message: String(localized: "not sent: \(r.reason ?? "")")) }
            text = ""
        }
    }

    /// `term.input` reaches only a stream this client attached, so attach for the one write and let go.
    private func press(_ bytes: String) async {
        await run {
            let a = try await model.client.request("term.attach", ["taskId": taskId, "tabId": tabId], as: TermAttachResult.self)
            defer { model.client.fire("term.detach", ["stream": a.stream]) }
            _ = try await model.client.request("term.input", ["stream": a.stream, "data": bytes], as: EmptyResult.self)
        }
    }

    private func run(_ act: () async throws -> Void) async {
        busy = true; note = nil
        do {
            try await act()
            try? await Task.sleep(for: .milliseconds(600))
            await readTail()
        } catch let e as BridgeError {
            note = e.message
        } catch { note = error.localizedDescription }
        busy = false
    }
}
