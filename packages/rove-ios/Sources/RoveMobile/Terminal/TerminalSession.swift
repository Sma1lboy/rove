import Foundation
import Observation

enum TerminalMode: String, CaseIterable, Identifiable {
    case fit = "Fit"
    case watch = "Watch"
    var id: String { rawValue }
    /// Display caption (the raw value stays the English id).
    var label: String {
        switch self {
        case .fit: String(localized: "fit")
        case .watch: String(localized: "watch")
        }
    }
}

@MainActor
protocol TerminalSurface: AnyObject {
    func reset()
    func feed(_ data: Data)
    func currentSize() -> (cols: Int, rows: Int)?
    var isAlternateScreen: Bool { get }
    var isScrolledToBottom: Bool { get }
    func scrollToBottom()
    func scrollToTop()
    func scrollPage(up: Bool)
    func search(_ term: String, forward: Bool) -> SearchSummary?
    func clearSearch()
    func selectedText() -> String?
    func clearSelection()
}

/// One attached terminal tab: attach/replay/stream/input/resize/detach, surviving reconnects.
@MainActor @Observable
final class TerminalSession {
    static let watchCols = 120

    let taskId: String
    let tabId: String
    static let liveStatus = String(localized: "Live")
    static let attachingStatus = String(localized: "Attaching…")
    private(set) var status = TerminalSession.attachingStatus
    private(set) var exited = false
    /// Total terminal bytes fed to the view (exposed to UI tests as the terminal's accessibility value).
    private(set) var bytesReceived = 0
    private(set) var keys = KeyMapper()
    /// Scrolled up into history; drives the `latest` jump.
    var atBottom = true
    /// The view holds a text selection; drives the `copy` chip.
    var hasSelection = false
    /// An app owns the screen (alternate buffer): the terminal keeps no scrollback for it.
    var alternateScreen = false
    /// Attachment refs pasted since the last reply; the next one is `images[count]` like the TUI composer.
    var attachmentCount = 0
    /// A short-lived line over the terminal ("interrupt sent", an upload error).
    private(set) var flashText: String?
    @ObservationIgnored private var flashTask: Task<Void, Never>?
    var mode: TerminalMode = .fit {
        didSet { if oldValue != mode { switchMode() } }
    }

    @ObservationIgnored let client: BridgeClient
    @ObservationIgnored weak var surface: TerminalSurface?
    @ObservationIgnored private var observer: UUID?
    @ObservationIgnored private var wanted = false
    @ObservationIgnored private var stream: String?
    @ObservationIgnored private var inFlight = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var size: (cols: Int, rows: Int)?
    @ObservationIgnored private var sentSize: (cols: Int, rows: Int)?
    @ObservationIgnored private var buffered: [(stream: String, bytes: Data)] = []

    init(client: BridgeClient, taskId: String, tabId: String) {
        self.client = client; self.taskId = taskId; self.tabId = tabId
    }

    // MARK: Lifecycle

    func start() {
        guard !wanted else { return }
        wanted = true
        observer = client.observe { [weak self] e in self?.handle(e) }
        attach()
        // Fallback when the view never reports a size before we need one.
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard let self, self.wanted, self.size == nil, let s = self.surface?.currentSize() else { return }
            self.viewSized(cols: s.cols, rows: s.rows)
        }
    }

    func stop() {
        wanted = false
        generation += 1
        if let o = observer { client.removeObserver(o); observer = nil }
        detachCurrent()
    }

    private func detachCurrent() {
        if let s = stream { client.fire("term.detach", ["stream": s]) }
        stream = nil; sentSize = nil; inFlight = false
    }

    private func switchMode() {
        guard wanted else { return }
        detachCurrent()
        generation += 1
        attach()
    }

    // MARK: Attach

    private func attach() {
        guard wanted, !inFlight else { return }
        var args: [String: Any] = ["taskId": taskId, "tabId": tabId]
        var attachedSize: (cols: Int, rows: Int)?
        if mode == .fit {
            guard let size else { return } // wait for the first layout pass
            args["cols"] = size.cols; args["rows"] = size.rows
            attachedSize = size
        }
        inFlight = true
        stream = nil
        buffered = []
        status = Self.attachingStatus
        let gen = generation
        Task {
            do {
                let r = try await client.request("term.attach", args, as: TermAttachResult.self)
                guard wanted, gen == generation else {
                    client.fire("term.detach", ["stream": r.stream])
                    if gen != generation { return }
                    inFlight = false
                    return
                }
                inFlight = false
                stream = r.stream
                sentSize = attachedSize
                exited = !r.alive
                status = r.alive ? Self.liveStatus : String(localized: "Process exited")
                surface?.reset()
                if let replay = Data(base64Encoded: r.replay), !replay.isEmpty { feed(replay) }
                for b in buffered where b.stream == r.stream { feed(b.bytes) }
                buffered = []
                // The view may have been resized while attaching.
                if mode == .fit, let size, size.cols != attachedSize?.cols || size.rows != attachedSize?.rows { sendResize(size) }
            } catch {
                guard gen == generation else { return }
                inFlight = false
                status = error.localizedDescription
            }
        }
    }

    private func handle(_ event: BridgeEvent) {
        switch event {
        case .connected:
            if wanted { inFlight = false; generation += 1; attach() }
        case .termData(let s, let bytes):
            if let stream { if s == stream { feed(bytes) } }
            else if inFlight { buffered.append((s, bytes)) }
        case .termExit(let s, _):
            if s == stream { exited = true; status = String(localized: "Process exited") }
        case .tasks, .notice:
            break
        }
    }

    private func feed(_ data: Data) {
        bytesReceived += data.count
        surface?.feed(data)
        refreshScreenState()
    }

    // MARK: View → session

    func viewSized(cols: Int, rows: Int) {
        guard cols > 0, rows > 0 else { return }
        size = (cols, rows)
        guard mode == .fit, wanted else { return }
        if stream == nil { attach() } else { sendResize((cols, rows)) }
    }

    private func sendResize(_ s: (cols: Int, rows: Int)) {
        guard let stream, sentSize?.cols != s.cols || sentSize?.rows != s.rows else { return }
        sentSize = s
        client.fire("term.resize", ["stream": stream, "cols": s.cols, "rows": s.rows])
    }

    // MARK: Input

    /// Bytes emitted by SwiftTerm for keyboard typing (terminal-generated query replies are dropped).
    func typed(_ bytes: [UInt8]) {
        let kept = QueryReplyFilter.filter(bytes)
        guard !kept.isEmpty else { return }
        send(keys.transformTyped(String(decoding: kept, as: UTF8.self)))
    }

    func press(_ key: AccessoryKey) {
        if let text = keys.press(key) { send(text) }
    }

    /// Composer / chip reply: text, then Enter. A multi-line message goes in as ONE bracketed paste so the
    /// engine does not submit at the first newline.
    /// Enter follows after a short pause (the host's own submit delay): engine TUIs treat text+CR arriving in
    /// one burst as a paste and insert a newline instead of submitting.
    func reply(_ text: String) {
        send(PasteEncoding.message(text))
        attachmentCount = 0
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            self?.send("\r")
        }
    }

    /// Text into the engine's input as a bracketed paste, not submitted (attachment paths).
    func paste(_ text: String) { send(PasteEncoding.paste(text)) }

    private func send(_ text: String) {
        guard let stream, !text.isEmpty else { return }
        client.fire("term.input", ["stream": stream, "data": text])
    }

    // MARK: Scrollback / reset

    /// Keeps the observable scroll and selection flags in step with the view.
    func refreshScreenState() {
        guard let surface else { return }
        let alt = surface.isAlternateScreen
        if alt != alternateScreen { alternateScreen = alt }
        let bottom = alt || surface.isScrolledToBottom
        if bottom != atBottom { atBottom = bottom }
        let selected = surface.selectedText() != nil
        if selected != hasSelection { hasSelection = selected }
    }

    /// F5: drop the local screen and scrollback, then nudge the PTY's size so the app repaints itself.
    /// A one-column bounce is the only way to make SIGWINCH fire when the size would not otherwise change.
    func resetAndRedraw() {
        surface?.clearSearch()
        surface?.reset()
        refreshScreenState()
        guard let stream, let s = surface?.currentSize() else { return }
        client.fire("term.resize", ["stream": stream, "cols": max(s.cols - 1, 10), "rows": s.rows])
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard let self, self.stream == stream else { return }
            self.client.fire("term.resize", ["stream": stream, "cols": s.cols, "rows": s.rows])
        }
    }

    /// Shows `text` over the terminal for a couple of seconds.
    func flash(_ text: String) {
        flashTask?.cancel()
        flashText = text
        flashTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            if !Task.isCancelled { self?.flashText = nil }
        }
    }
}
