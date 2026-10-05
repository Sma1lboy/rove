import SwiftUI
import SwiftTerm
import UIKit

struct SwiftTermView: UIViewRepresentable {
    var session: TerminalSession

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    func makeUIView(context: Context) -> TerminalView {
        let tv = TerminalView(frame: .zero)
        tv.terminalDelegate = context.coordinator
        tv.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        tv.inputAccessoryView = nil // the key row is a permanent SwiftUI view (KeyRow)
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
        func reset() { view?.getTerminal().resetToInitialState() }
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
