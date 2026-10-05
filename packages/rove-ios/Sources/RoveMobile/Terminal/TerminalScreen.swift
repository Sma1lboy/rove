import SwiftUI

struct TerminalScreen: View {
    let taskId: String
    let tab: TabRow
    @Environment(AppModel.self) private var model
    @State private var session: TerminalSession?

    var body: some View {
        VStack(spacing: 0) {
            if let session {
                Text("\(session.status) · \(session.bytesReceived) B")
                    .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(3)
                    .background(session.exited ? Color.gray.opacity(0.3) : session.status == "Live" ? Color.clear : Color.orange.opacity(0.25))
                    .accessibilityIdentifier("terminalStatus")
                SwiftTermView(session: session)
                KeyRow(session: session)
                Composer(session: session)
            } else {
                Spacer()
            }
        }
        .keyboardDoneButton()
        .navigationTitle(tab.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let session {
                @Bindable var s = session
                ToolbarItem(placement: .topBarTrailing) {
                    Picker("Mode", selection: $s.mode) {
                        ForEach(TerminalMode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 130)
                }
            }
        }
        .onAppear {
            if session == nil { session = TerminalSession(client: model.client, taskId: taskId, tabId: tab.id) }
            session?.start()
        }
        .onDisappear { session?.stop() }
    }
}

/// Non-live reply mode: compose text, Send appends Enter; quick chips send a canned reply.
struct Composer: View {
    var session: TerminalSession
    @State private var text = ""

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                ForEach(["continue", "yes"], id: \.self) { chip in
                    Button(chip) { session.reply(chip) }
                        .buttonStyle(.bordered).controlSize(.small)
                }
                Spacer()
            }
            HStack {
                TextField("Reply…", text: $text, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .accessibilityIdentifier("composerField")
                Button("Send", action: send)
                    .buttonStyle(.borderedProminent)
                    .disabled(text.isEmpty)
                    .accessibilityIdentifier("sendButton")
            }
        }
        .padding(8)
        .background(.bar)
    }

    private func send() {
        guard !text.isEmpty else { return }
        session.reply(text)
        text = ""
    }
}

/// Always-visible key row: Esc, Tab, ⇧Tab, Ctrl (sticky), arrows, Enter, ^C — one tap, no keyboard needed.
struct KeyRow: View {
    var session: TerminalSession

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(AccessoryKey.allCases, id: \.self) { key in
                    let armed = key == .ctrl && session.keys.ctrlArmed
                    Button { session.press(key) } label: {
                        Text(key.label).font(.callout.weight(.medium))
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(armed ? Color.blue : Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8))
                            .foregroundStyle(armed ? Color.white : Color.primary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("key-\(key.label)")
                }
            }
            .padding(.horizontal, 8)
        }
        .padding(.vertical, 4)
        .background(.bar)
    }
}
