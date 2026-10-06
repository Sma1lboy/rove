import SwiftUI

/// A small mono control on the (always espresso) terminal: solid, hairline, never glass.
private struct TermChip: View {
    var text: String
    var tint: Color = Color(uiColor: TerminalPalette.foreground)
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(Theme.mono(12, .medium))
                .foregroundStyle(tint)
                .fixedSize()
                .padding(.horizontal, 10)
                .frame(minHeight: 30)
                .background(Color(uiColor: UIColor(hex: 0x2B2A27)),
                            in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                    .strokeBorder(Color(uiColor: UIColor(hex: 0x3A3835))))
        }
        .buttonStyle(.pressable)
    }
}

/// Scrollback tools over the terminal: a `latest` jump once scrolled up, a `copy` chip while text is
/// selected, find-in-scrollback, and reset. The terminal's own pan scrolls the history.
struct TerminalTools: View {
    var session: TerminalSession
    @State private var searching = false
    @State private var query = ""
    @State private var summary: SearchSummary?
    @State private var copied = false
    @State private var confirmReset = false
    @FocusState private var queryFocused: Bool

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                if searching { searchBar }
                Spacer()
            }
            VStack {
                Spacer()
                HStack(alignment: .bottom) {
                    if session.hasSelection || copied { copyChip }
                    Spacer()
                    if !session.atBottom { TermChip(text: String(localized: "latest ↓"), tint: Theme.accent) { session.surface?.scrollToBottom() } }
                }
                .padding(8)
            }
            if !searching {
                VStack {
                    HStack { Spacer(); toolsMenu }
                    Spacer()
                }
                .padding(6)
            }
        }
        .confirmationDialog("Reset this terminal?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset terminal", role: .destructive) { session.resetAndRedraw() }
        } message: {
            Text("Clears this phone's screen and scrollback, then asks the app to redraw. The engine keeps running.")
        }
    }

    private var toolsMenu: some View {
        Menu {
            Button { openSearch() } label: { Label("Find in scrollback", systemImage: "magnifyingglass") }
            Button { session.surface?.scrollToTop() } label: { Label("Top of scrollback", systemImage: "arrow.up.to.line") }
                .disabled(session.alternateScreen)
            Button { session.surface?.scrollPage(up: true) } label: { Label("Page up", systemImage: "chevron.up") }
            Button { session.surface?.scrollPage(up: false) } label: { Label("Page down", systemImage: "chevron.down") }
            Divider()
            Button(role: .destructive) { confirmReset = true } label: { Label("Reset terminal…", systemImage: "arrow.counterclockwise") }
        } label: {
            Text("⋯")
                .font(Theme.mono(14, .bold))
                .foregroundStyle(Color(uiColor: TerminalPalette.foreground))
                .frame(width: 34, height: 30)
                .background(Color(uiColor: UIColor(hex: 0x2B2A27)),
                            in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                    .strokeBorder(Color(uiColor: UIColor(hex: 0x3A3835))))
        }
        .accessibilityLabel("Terminal tools")
        .accessibilityIdentifier("terminalTools")
    }

    private var copyChip: some View {
        TermChip(text: copied ? String(localized: "copied") : String(localized: "copy"), tint: copied ? Theme.success : Theme.accent) {
            guard let text = session.surface?.selectedText() else { return }
            UIPasteboard.general.string = text
            session.surface?.clearSelection()
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        }
        .accessibilityIdentifier("copySelection")
    }

    // MARK: Search

    private var searchBar: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                TextField("", text: $query, prompt: Text("find in scrollback").foregroundStyle(Color(uiColor: TerminalPalette.foreground).opacity(0.5)))
                    .font(Theme.mono(13))
                    .foregroundStyle(Color(uiColor: TerminalPalette.foreground))
                    .tint(Theme.accent)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($queryFocused)
                    .onSubmit { run(forward: true) }
                    .onChange(of: query) { run(forward: true) }
                    .padding(.horizontal, 10).frame(height: 32)
                    .background(Color(uiColor: UIColor(hex: 0x2B2A27)), in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Color(uiColor: UIColor(hex: 0x3A3835))))
                    .accessibilityIdentifier("searchField")
                Text(counter)
                    .font(Theme.mono(12)).monospacedDigit()
                    .foregroundStyle(summary?.total == 0 ? Theme.error : Color(uiColor: TerminalPalette.foreground))
                    .frame(minWidth: 44)
                TermChip(text: "‹") { run(forward: false) }
                TermChip(text: "›") { run(forward: true) }
                TermChip(text: "×") { closeSearch() }
            }
            if session.alternateScreen {
                Text("an app owns the screen — only what it shows now is searchable; its history is its own")
                    .font(Theme.mono(11))
                    .foregroundStyle(Color(uiColor: TerminalPalette.foreground).opacity(0.7))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(8)
        .background(Color(uiColor: TerminalPalette.background))
    }

    private var counter: String {
        guard let summary else { return "" }
        return summary.total == 0 ? String(localized: "no match") : "\(summary.index)/\(summary.total)"
    }

    private func openSearch() {
        searching = true
        queryFocused = true
    }

    private func closeSearch() {
        searching = false
        queryFocused = false
        query = ""
        summary = nil
        session.surface?.clearSearch()
    }

    private func run(forward: Bool) {
        summary = session.surface?.search(query, forward: forward)
        session.refreshScreenState()
    }
}
