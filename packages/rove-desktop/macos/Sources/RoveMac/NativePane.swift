import AppKit
import SwiftTerm

private final class SelectableTerminal: TerminalView {
    var selectionDidChange: ((Bool) -> Void)?
    override func selectionChanged(source: Terminal) {
        super.selectionChanged(source: source)
        selectionDidChange?(selectionActive)
    }
}

final class NativePane: NSObject, TerminalViewDelegate {
    let id: String
    let view: TerminalView
    let scroller: TerminalScroller
    private let event: ([String: Any]) -> Void
    private var parsing = false
    private var replaying = false
    private var palette: [String] = []
    private var scrollback = 0

    init(id: String, event: @escaping ([String: Any]) -> Void) {
        self.id = id
        self.event = event
        let terminal = SelectableTerminal(frame: .zero, font: .monospacedSystemFont(ofSize: 13, weight: .regular))
        view = terminal
        scroller = TerminalScroller(terminal: terminal)
        super.init()
        view.terminalDelegate = self
        terminal.selectionDidChange = { event(["id": id, "action": "selection", "selected": $0]) }
    }
    func setAppearance(_ values: [String: Any]) {
        if let rows = values["scrollback"] as? Int, rows != scrollback, (100...100000).contains(rows) {
            scrollback = rows
            view.changeScrollback(rows)
        }
        if let subtle = values["subtle"] as? String, let ink = Self.color(subtle) { scroller.subtle = ink }
        if let muted = values["muted"] as? String, let ink = Self.color(muted) { scroller.muted = ink }
        guard let foreground = values["foreground"] as? String, let background = values["background"] as? String,
              palette != [foreground, background], let ink = Self.color(foreground), let paper = Self.color(background) else { return }
        palette = [foreground, background]
        view.appearance = NSAppearance(named: values["dark"] as? Bool != false ? .darkAqua : .aqua)
        view.nativeForegroundColor = ink
        view.nativeBackgroundColor = paper
    }
    private static func color(_ hex: String) -> NSColor? {
        guard hex.count == 7, hex.first == "#", let rgb = Int(hex.dropFirst(), radix: 16) else { return nil }
        return NSColor(srgbRed: CGFloat(rgb >> 16) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
                       blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }
    func reportSize() {
        let term = view.getTerminal()
        sizeChanged(source: view, newCols: term.cols, newRows: term.rows)
    }
    func feed(_ bytes: Data, op: String, chars: Int) {
        // Only live output may answer a terminal query.
        parsing = true
        replaying = op != "data"
        if replaying { view.feed(text: "\u{1b}c") }
        if !bytes.isEmpty { view.feed(byteArray: Array(bytes)[...]) }
        scroller.sync(fromUser: false)
        parsing = false
        replaying = false
        if op != "replay" { event(["id": id, "action": "parsed", "chars": chars]) }
    }
    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        guard !replaying, (parsing || !view.isHidden), let text = String(bytes: data, encoding: .utf8) else { return }
        event(["id": id, "action": parsing ? "reply" : "input", "data": text])
    }
    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        scroller.sync(fromUser: false)
        guard !view.isHidden, newCols >= 10, newRows >= 4 else { return }
        event(["id": id, "action": "size", "cols": newCols, "rows": newRows])
    }
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) { scroller.sync(fromUser: !parsing) }
    func bell(source: TerminalView) {}
    func clipboardCopy(source: TerminalView, content: Data) {}
    func clipboardRead(source: TerminalView) -> Data? { nil }
    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        guard let url = URL(string: link), ["https", "http"].contains(url.scheme ?? "") else { return }
        NSWorkspace.shared.open(url)
    }
}
