import AppKit
import GhosttyTerminal

/// Ghostty owns the Metal surface, VT parser and the input method. The bridge owns the shell and PTY.
@MainActor
final class NativePane: NSObject, TerminalSurfaceLifecycleDelegate, TerminalSurfaceScrollbarDelegate,
                        TerminalSurfaceOpenURLDelegate, TerminalSurfaceClipboardConfirmationDelegate {
    private static let controller = TerminalController(configuration: .default, theme: TerminalTheme())
    let id: String
    let view = HostedTerminalView(frame: .zero)
    private(set) lazy var session = InMemoryTerminalSession(
        write: { [weak self] bytes in DispatchQueue.main.async { [weak self] in self?.write(bytes) } },
        resize: { [weak self] size in DispatchQueue.main.async { [weak self] in self?.resize(size) } },
        suppressesPixelOnlyResizes: true
    )
    let scroller: TerminalScroller
    private(set) var surface: TerminalSurface?
    private(set) var columns = 0
    private(set) var rows = 0
    private var selected = false
    private let event: ([String: Any]) -> Void
    private var pendingAck = 0
    private var draining = false
    private var replayGeneration = 0

    init(id: String, event: @escaping ([String: Any]) -> Void) {
        self.id = id
        self.event = event
        scroller = TerminalScroller(terminal: view)
        super.init()
        view.delegate = self
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = Self.controller
        view.selectionChanged = { [weak self] in self?.reportSelection() }
        view.scrolling = { [weak self] in self?.scroller.revealForUserScroll() }
        scroller.scrollTo = { [weak self] row in _ = self?.surface?.scrollToRow(row) }
        view.setAccessibilityLabel("Terminal")
    }

    func terminalDidAttachSurface(_ surface: TerminalSurface) {
        self.surface = surface
        flushAcknowledgements()
    }
    func terminalDidDetachSurface() {
        surface = nil
    }
    func terminalDidUpdateScrollbar(_ geometry: TerminalScrollbar) {
        scroller.update(geometry)
    }
    func terminalDidRequestOpenURL(_ url: String, kind: TerminalOpenURLKind) {
        guard let link = URL(string: url), ["https", "http"].contains(link.scheme?.lowercased() ?? "") else { return }
        NSWorkspace.shared.open(link)
    }
    func terminalDidRequestClipboardConfirmation(_ request: TerminalClipboardConfirmationRequest) {
        guard case .paste = request.kind, let window = view.window, !view.isHidden else {
            request.respond(allow: false)
            return
        }
        let alert = NSAlert()
        alert.messageText = "Paste into this terminal?"
        alert.informativeText = String(request.contents.prefix(200))
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Paste")
        alert.beginSheetModal(for: window) { [weak self] result in
            request.respond(allow: result == .alertSecondButtonReturn && self?.view.window === window && self?.view.isHidden == false)
        }
    }

    func setAppearance(_ values: [String: Any]) {
        if let subtle = values["subtle"] as? String, let color = Self.color(subtle) { scroller.subtle = color }
        if let muted = values["muted"] as? String, let color = Self.color(muted) { scroller.muted = color }
        guard let foreground = values["foreground"] as? String, Self.color(foreground) != nil,
              let background = values["background"] as? String, Self.color(background) != nil else { return }
        var config = TerminalConfiguration().foreground(foreground).background(background).fontSize(13)
            .custom("clipboard-read", "deny").custom("clipboard-write", "deny")
        if let lines = values["scrollback"] as? Int, (100...100000).contains(lines) {
            // Ghostty budgets scrollback in bytes; allow roughly 1 KiB per requested row.
            config = config.custom("scrollback-limit", String(lines * 1024))
        }
        view.controller?.setTerminalConfiguration(config)
        view.appearance = NSAppearance(named: values["dark"] as? Bool != false ? .darkAqua : .aqua)
    }
    private static func color(_ hex: String) -> NSColor? {
        guard hex.count == 7, hex.first == "#", let rgb = Int(hex.dropFirst(), radix: 16) else { return nil }
        return NSColor(srgbRed: CGFloat(rgb >> 16) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
                       blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }

    private func resize(_ viewport: InMemoryTerminalViewport) {
        columns = Int(viewport.columns)
        rows = Int(viewport.rows)
        reportSize()
    }
    func reportSize() {
        guard !view.isHidden, columns >= 10, rows >= 4 else { return }
        event(["id": id, "action": "size", "cols": columns, "rows": rows])
    }

    func feed(_ bytes: Data, op: String, chars: Int) {
        if op == "data" {
            session.receive(bytes)
        } else {
            replayGeneration &+= 1
            pendingAck = 0
            session.discardPendingOutput()
            session.receiveReplay(Data([0x1b, 0x63]) + bytes)
        }
        if op != "replay" {
            pendingAck += chars
            flushAcknowledgements()
        }
    }

    /// The bridge may resume a flooded PTY only after Ghostty has consumed the bytes.
    private func flushAcknowledgements() {
        guard !draining, pendingAck > 0, surface != nil else { return }
        let generation = replayGeneration
        let chars = pendingAck
        pendingAck = 0
        draining = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self, session] in
            let parsed = session.waitForPendingOutput()
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.draining = false
                if self.replayGeneration == generation {
                    if parsed { self.event(["id": self.id, "action": "parsed", "chars": chars]) }
                    else { self.pendingAck += chars }
                }
                self.flushAcknowledgements()
            }
        }
    }

    private func write(_ bytes: Data) {
        guard let text = String(data: bytes, encoding: .utf8), !text.isEmpty else { return }
        event(["id": id, "action": "input", "data": text])
    }
    func scrollPage(_ direction: Int) {
        scroller.revealForUserScroll()
        _ = view.performBindingAction(direction < 0 ? "scroll_page_up" : "scroll_page_down")
    }
    func copySelection() {
        guard view.copySelectedTextToPasteboard() else { return }
        _ = view.performBindingAction("clear_selection")
        reportSelection()
    }
    private func reportSelection() {
        let value = surface?.hasSelection() == true
        guard value != selected else { return }
        selected = value
        event(["id": id, "action": "selection", "selected": value])
    }
}

final class HostedTerminalView: AppTerminalView {
    var selectionChanged: (() -> Void)?
    var scrolling: (() -> Void)?
    override func mouseUp(with event: NSEvent) { super.mouseUp(with: event); selectionChanged?() }
    override func keyDown(with event: NSEvent) { super.keyDown(with: event); selectionChanged?() }
    override func selectAll(_ sender: Any?) { super.selectAll(sender); selectionChanged?() }
    override func scrollWheel(with event: NSEvent) { super.scrollWheel(with: event); scrolling?() }
}
