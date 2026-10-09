import SwiftUI
import SwiftTerm
import UIKit

/// Applies `Theme.Terminal` to a SwiftTerm view.
enum TerminalPalette {
    @MainActor static func apply(to tv: TerminalView) {
        tv.installColors(Theme.Terminal.ansi.map {
            SwiftTerm.Color(red8: UInt16(($0 >> 16) & 0xFF), green8: UInt16(($0 >> 8) & 0xFF), blue8: UInt16($0 & 0xFF))
        })
        tv.nativeBackgroundColor = Theme.Terminal.backgroundUI
        tv.nativeForegroundColor = Theme.Terminal.foregroundUI
        tv.caretColor = .clear
        tv.backgroundColor = Theme.Terminal.backgroundUI
        tv.getTerminal().setCursorStyle(.steadyBar)
    }
}

/// SwiftTerm strokes a hollow box over the cursor cell whenever the view isn't first responder —
/// right on top of an engine's placeholder. Unfocused (typing goes through the composer), the
/// caret is hidden; focused, it is a terracotta bar beside the text rather than a block on it.
final class RoveTerminalView: TerminalView {
    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        if ok { caretColor = Theme.Terminal.caretUI }
        return ok
    }

    override func resignFirstResponder() -> Bool {
        let ok = super.resignFirstResponder()
        if ok { caretColor = .clear }
        return ok
    }

    /// Engines ask for a blinking caret (DECSCUSR). Blinking is a never-ending UIKit animation that keeps the app
    /// from ever going idle, for UI tests and for the battery, and the caret is hidden unless focused anyway,
    /// so every style is shown steady.
    override func cursorStyleChanged(source: Terminal, newStyle: CursorStyle) {
        let steady: CursorStyle
        switch newStyle {
        case .blinkBlock, .steadyBlock: steady = .steadyBlock
        case .blinkUnderline, .steadyUnderline: steady = .steadyUnderline
        case .blinkBar, .steadyBar: steady = .steadyBar
        }
        super.cursorStyleChanged(source: source, newStyle: steady)
    }

    /// Long-press selection and search results land here; the session mirrors it as the `copy` chip.
    var onSelectionChange: (() -> Void)?
    override func selectionChanged(source: Terminal) {
        super.selectionChanged(source: source)
        onSelectionChange?()
    }
}

struct SwiftTermView: UIViewRepresentable {
    var session: TerminalSession

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    func makeUIView(context: Context) -> TerminalView {
        let tv = RoveTerminalView(frame: .zero)
        tv.terminalDelegate = context.coordinator
        TerminalFont.apply(to: tv, size: 13)
        tv.inputAccessoryView = nil // the key row is a permanent SwiftUI view (KeyRow)
        TerminalPalette.apply(to: tv)
        tv.onSelectionChange = { [weak session] in session?.refreshScreenState() }
        context.coordinator.view = tv
        session.surface = context.coordinator
        return tv
    }

    func updateUIView(_ tv: TerminalView, context: Context) {
        context.coordinator.applyMode(session.mode, to: tv)
    }

    @MainActor
    final class Coordinator: NSObject, TerminalViewDelegate, TerminalSurface {
        let session: TerminalSession
        weak var view: TerminalView?
        private var appliedMode: TerminalMode?
        private var forcing = false

        init(session: TerminalSession) { self.session = session }

        func applyMode(_ mode: TerminalMode, to tv: TerminalView) {
            guard appliedMode != mode else { return }
            appliedMode = mode
            switch mode {
            case .fit:
                TerminalFont.apply(to: tv, size: 13)
            case .watch:
                // Maple Mono's advance is 0.6 em; pick a size so 120 columns span the view width.
                let width = max(tv.bounds.width, UIScreen.main.bounds.width)
                let size = max(4, (width / (CGFloat(TerminalSession.watchCols) * 0.6)).rounded(.down))
                TerminalFont.apply(to: tv, size: size)
            }
            tv.setNeedsLayout()
        }

        // MARK: TerminalSurface
        func reset() {
            guard let view else { return }
            view.getTerminal().resetToInitialState()
            view.getTerminal().setCursorStyle(.steadyBar)
        }
        func feed(_ data: Data) { view?.feed(byteArray: [UInt8](data)[...]) }
        func currentSize() -> (cols: Int, rows: Int)? {
            guard let t = view?.getTerminal() else { return nil }
            return (t.cols, t.rows)
        }

        var isAlternateScreen: Bool { view?.getTerminal().isCurrentBufferAlternate ?? false }
        var isScrolledToBottom: Bool {
            guard let view else { return true }
            return view.scrollThumbsize >= 1 || view.scrollPosition >= 0.999
        }
        func scrollToBottom() { view?.scrollTo(row: Int.max) }
        func scrollToTop() { view?.scrollTo(row: 0) }
        /// On the alternate screen SwiftTerm sends PageUp/PageDown to the app instead of scrolling.
        func scrollPage(up: Bool) { if up { view?.pageUp() } else { view?.pageDown() } }
        func search(_ term: String, forward: Bool) -> SearchSummary? {
            guard let view, !term.isEmpty else { return nil }
            let found = forward ? view.findNext(term) : view.findPrevious(term)
            guard found else { return SearchSummary(index: 0, total: 0) }
            let s = view.searchMatchSummary(term)
            return SearchSummary(index: s.index, total: s.total)
        }
        func clearSearch() { view?.clearSearch() }
        func selectedText() -> String? {
            guard let text = view?.getSelection(), !text.isEmpty else { return nil }
            return text
        }
        func clearSelection() { view?.selectNone() }

        // MARK: TerminalViewDelegate
        func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
            switch session.mode {
            case .fit:
                session.viewSized(cols: newCols, rows: newRows)
            case .watch:
                guard !forcing, newCols != TerminalSession.watchCols else { return }
                forcing = true
                source.resize(cols: TerminalSession.watchCols, rows: newRows)
                forcing = false
            }
        }
        func setTerminalTitle(source: TerminalView, title: String) {}
        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
        func send(source: TerminalView, data: ArraySlice<UInt8>) { session.typed(Array(data)) }
        func scrolled(source: TerminalView, position: Double) { session.refreshScreenState() }
        func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
            if let url = URL(string: link) { UIApplication.shared.open(url) }
        }
        func bell(source: TerminalView) {}
        func clipboardCopy(source: TerminalView, content: Data) {
            if let s = String(data: content, encoding: .utf8) { UIPasteboard.general.string = s }
        }
        func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
        func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
    }
}
