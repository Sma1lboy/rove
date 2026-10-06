import SwiftUI

/// The selected tab's live terminal, its key row and the reply composer.
struct TerminalPane: View {
    var session: TerminalSession
    var engineName: String?

    var body: some View {
        VStack(spacing: 0) {
            // Inset so glyphs never touch the bezel; the view measures its columns from the inset width.
            SwiftTermView(session: session)
                .padding(.horizontal, 8)
                .padding(.top, 6)
                .background(Color(uiColor: TerminalPalette.background))
                .overlay(alignment: .top) { statusBanner }
                .overlay { TerminalTools(session: session) }
                .overlay(alignment: .bottom) { flashLine }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("terminal")
                .accessibilityValue("\(session.bytesReceived)")
            KeyRow(session: session)
            Composer(session: session, engineName: engineName)
        }
    }

    /// Only shown while not live: attach progress, an exit, or the attach error.
    @ViewBuilder private var statusBanner: some View {
        if session.status != TerminalSession.liveStatus {
            HStack(spacing: 8) {
                if !session.exited && session.status == TerminalSession.attachingStatus {
                    BrailleSpinner(size: 12)
                }
                Text(session.status.lowercased())
                    .font(Theme.mono(12))
                    .foregroundStyle(session.exited ? Theme.muted : Theme.ink)
                    .lineLimit(2)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.inset)
            .accessibilityIdentifier("terminalStatus")
            .transition(.opacity)
        }
    }

    @ViewBuilder private var flashLine: some View {
        if let text = session.flashText {
            Text(text.lowercased())
                .font(Theme.mono(12))
                .foregroundStyle(Color(uiColor: TerminalPalette.foreground))
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Color(uiColor: UIColor(hex: 0x2B2A27)), in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                .padding(.bottom, 44)
                .transition(.opacity)
                .accessibilityIdentifier("terminalFlash")
        }
    }
}

/// Always-visible key row — Esc, Tab, ⇧Tab, sticky Ctrl, arrows, Enter, ^C — then canned replies.
struct KeyRow: View {
    var session: TerminalSession

    /// Most-used first, so `enter` is on screen without scrolling.
    private static let order: [AccessoryKey] = [.esc, .enter, .up, .down, .tab, .shiftTab, .ctrl, .left, .right, .ctrlC]

    /// Mono-safe captions in the TUI's chord spelling.
    private static func caption(_ key: AccessoryKey) -> String {
        switch key {
        case .shiftTab: "shift+tab"
        case .ctrlC: "ctrl+c"
        default: key.label.lowercased()
        }
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Self.order, id: \.self) { key in
                    let armed = key == .ctrl && session.keys.ctrlArmed
                    Button { session.press(key) } label: {
                        Text(Self.caption(key))
                            .font(Theme.mono(13, .medium))
                            .foregroundStyle(armed ? Theme.paper : Theme.ink)
                            .fixedSize()
                            .padding(.horizontal, 10)
                            .frame(minWidth: 38, minHeight: 34)
                            .background(armed ? Theme.accent : Theme.surface,
                                        in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                                .strokeBorder(armed ? Theme.accent : Theme.line))
                    }
                    .buttonStyle(.pressable)
                    .accessibilityLabel(key.label)
                    .accessibilityIdentifier("key-\(key.label)")
                }
                Rectangle().fill(Theme.line).frame(width: 1, height: 22).padding(.horizontal, 2)
                Button { Task { await session.interrupt() } } label: {
                    Text("interrupt")
                        .font(Theme.mono(13, .medium))
                        .foregroundStyle(Theme.ink)
                        .fixedSize()
                        .padding(.horizontal, 10)
                        .frame(minHeight: 34)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Theme.line))
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("Interrupt turn")
                .accessibilityIdentifier("key-interrupt")
                ForEach(["continue", "yes"], id: \.self) { reply in
                    Button { session.reply(reply) } label: {
                        Text(reply)
                            .font(Theme.mono(13, .medium))
                            .foregroundStyle(Theme.accent)
                            .fixedSize()
                            .padding(.horizontal, 10)
                            .frame(minHeight: 34)
                            .background(Theme.accentSoft,
                                        in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                    }
                    .buttonStyle(.pressable)
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 32)
        }
        // The row scrolls: fade the trailing edge so a cut-off key reads as "more", not as a typo.
        .mask(
            HStack(spacing: 0) {
                Color.black
                LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .leading, endPoint: .trailing)
                    .frame(width: 32)
            }
        )
        .padding(.top, 8)
        .background(Theme.paper)
    }
}
