import SwiftUI
import SwiftTerm
import UIKit

/// Rove's terminal palette — the claude-theme xterm palette the harness photographs
/// (rove-harness/src/lib/harness-terminal.ts). The terminal stays espresso in both app themes:
/// engines draw for a dark background and never learn ours (query replies are filtered).
enum TerminalPalette {
    static let background = UIColor(hex: 0x141413)
    static let foreground = UIColor(hex: 0xEAE7DF)
    static let caret = UIColor(hex: 0xCC785C)
    static let ansi: [UInt32] = [
        0x141413, 0xD47563, 0x9ACA86, 0xE8C96B, 0x61AAF2, 0x9B87F5, 0xD4967E, 0xA9A39A,
        0x6B665F, 0xD47563, 0x9ACA86, 0xE8C96B, 0x61AAF2, 0x9B87F5, 0xE0AB96, 0xEAE7DF,
    ]

    @MainActor static func apply(to tv: TerminalView) {
        tv.installColors(ansi.map {
            SwiftTerm.Color(red8: UInt16(($0 >> 16) & 0xFF), green8: UInt16(($0 >> 8) & 0xFF), blue8: UInt16($0 & 0xFF))
        })
        tv.nativeBackgroundColor = background
        tv.nativeForegroundColor = foreground
        tv.caretColor = .clear
        tv.backgroundColor = background
        tv.getTerminal().setCursorStyle(.steadyBar)
    }
}

/// SwiftTerm strokes a hollow box over the cursor cell whenever the view isn't first responder —
/// right on top of an engine's placeholder. Unfocused (typing goes through the composer), the
/// caret is hidden; focused, it is a terracotta bar beside the text rather than a block on it.
final class RoveTerminalView: TerminalView {
    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        if ok { caretColor = TerminalPalette.caret }
        return ok
    }

    override func resignFirstResponder() -> Bool {
        let ok = super.resignFirstResponder()
        if ok { caretColor = .clear }
        return ok
    }
}

struct SwiftTermView: UIViewRepresentable {
    var session: TerminalSession

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    func makeUIView(context: Context) -> TerminalView {
        let tv = RoveTerminalView(frame: .zero)
        tv.terminalDelegate = context.coordinator
        tv.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        tv.inputAccessoryView = nil // the key row is a permanent SwiftUI view (KeyRow)
        TerminalPalette.apply(to: tv)
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
                tv.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
            case .watch:
                // Monospace advance ≈ 0.6 em; pick a size so 120 columns span the view width.
                let width = max(tv.bounds.width, UIScreen.main.bounds.width)
                let size = max(4, (width / (CGFloat(TerminalSession.watchCols) * 0.6)).rounded(.down))
                tv.font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
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
        func scrolled(source: TerminalView, position: Double) {}
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
