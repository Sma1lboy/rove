import AppKit
import WebKit

final class Workspace: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    let address: URL
    let window = WorkspaceWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 800),
                          styleMask: [.titled, .resizable, .closable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
    let web: WKWebView
    private var focusedID: String?
    private var panes: [String: NativePane] = [:]
    private lazy var content = WorkspaceContent(web: web) { [weak self] action in self?.emit(["action": action]) }

    init(address: URL) {
        self.address = address
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        self.web = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.add(self, name: "roveMac")
        web.navigationDelegate = self
        window.contentView = content
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window.title = "Rove"
        window.minSize = NSSize(width: 720, height: 480)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        installMenu()
        window.focusChanged = { [weak self] responder in
            guard let self else { return }
            let pane = self.panes.values.first(where: { $0.view === responder })
            if let old = self.focusedID, old != pane?.id { self.emit(["id": old, "action": "blur"]) }
            self.focusedID = pane?.id
            guard let pane else { return }
            self.emit(["id": pane.id, "action": "focus"])
            pane.reportSize()
        }
        window.makeKeyAndOrderFront(nil)
        web.load(URLRequest(url: address))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func windowWillClose(_ notification: Notification) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "roveMac")
    }

    private func installMenu() {
        let menu = NSMenu()
        func group(_ name: String, _ rows: [(String, Selector, String)]) {
            let item = NSMenuItem()
            menu.addItem(item)
            let group = NSMenu(title: name)
            item.submenu = group
            for (title, selector, key) in rows { group.addItem(withTitle: title, action: selector, keyEquivalent: key) }
        }
        group("Rove", [("Quit Rove", #selector(NSApplication.terminate(_:)), "q")])
        group("Edit", [("Cut", #selector(NSText.cut(_:)), "x"), ("Copy", #selector(NSText.copy(_:)), "c"),
                       ("Paste", #selector(NSText.paste(_:)), "v"), ("Select All", #selector(NSResponder.selectAll(_:)), "a")])
        group("Window", [("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
                         ("Close", #selector(NSWindow.performClose(_:)), "w")])
        NSApp.mainMenu = menu
    }

    func emit(_ event: [String: Any]) {
        web.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('rove-mac',{detail:event})); return true",
                                arguments: ["event": event], in: nil, in: .page, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if url.scheme == address.scheme && url.host == address.host && url.port == address.port {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        for pane in panes.values { pane.view.removeFromSuperview() }
        panes.removeAll()
        content.reset()
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.host == address.host, origin.protocol == address.scheme,
              origin.port == (address.port ?? (address.scheme == "https" ? 443 : 80)),
              let msg = message.body as? [String: Any], let op = msg["op"] as? String else { return }
        if op == "toolbar" {
            if let dark = msg["dark"] as? Bool {
                window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            }
            content.update(folded: msg["folded"] as? Bool == true, waiting: msg["waiting"] as? Bool == true,
                           back: msg["back"] as? Bool == true, forward: msg["forward"] as? Bool == true)
            return
        }
        guard let id = msg["id"] as? String else { return }
        if op == "frame" {
            guard let x = msg["x"] as? Double, let y = msg["y"] as? Double,
                  let w = msg["width"] as? Double, let h = msg["height"] as? Double else { return }
            let visible = msg["visible"] as? Bool == true && w > 1 && h > 1
            guard visible || panes[id] != nil else { return }
            let fresh = panes[id] == nil
            let pane = panes[id] ?? NativePane(id: id, event: { [weak self] in self?.emit($0) })
            panes[id] = pane
            if fresh { window.contentView?.addSubview(pane.view, positioned: .above, relativeTo: web) }
            pane.view.isHidden = !visible
            pane.view.setSurfaceVisible(visible)
            if visible {
                pane.view.frame = NSRect(x: web.frame.minX + x, y: web.frame.maxY - y - h, width: w, height: h)
                pane.setAppearance(msg)
                if fresh {
                    pane.reportSize()
                    if msg["focus"] as? Bool == true { window.makeFirstResponder(pane.view) }
                }
            } else if window.firstResponder === pane.view { window.makeFirstResponder(web) }
        } else if op == "appearance" {
            panes[id]?.setAppearance(msg)
        } else if op == "remove" {
            panes.removeValue(forKey: id)?.view.removeFromSuperview()
        } else if op == "focus", let view = panes[id]?.view, !view.isHidden {
            window.makeFirstResponder(view)
        } else if op == "copy" {
            panes[id]?.copySelection()
        } else if op == "scroll", let direction = msg["direction"] as? Int {
            panes[id]?.scrollPage(direction)
        } else if ["replay", "reset", "data"].contains(op), let encoded = msg["data"] as? String,
                  let data = Data(base64Encoded: encoded) {
            panes[id]?.feed(data, op: op, chars: encoded.utf8.count)
        }
    }
}
