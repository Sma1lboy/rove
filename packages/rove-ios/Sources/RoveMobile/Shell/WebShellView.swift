import SwiftUI
import WebKit

/// rove-web, full screen. The page owns layout, safe areas (`viewport-fit=cover` + `env(safe-area-inset-*)`), the
/// soft keyboard (`viewport.ts`) and its own back swipe; this view only keeps WebKit's browser habits out of the way.
struct WebShellView: UIViewRepresentable {
    var computer: ShellComputer
    /// Bumped to reload the page (retry after a failed load).
    var reloadToken: Int
    var onFail: (String?) -> Void
    var onSwitch: () -> Void
    /// The page's background, on load and whenever its theme changes; the shell paints its own edges with it.
    var onPage: (UIColor) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Pinch and double-tap zoom belong to a browser, not an app; the page fits the screen already.
        // `viewport-fit=cover` because this view runs edge to edge and never insets its scroll view: without it
        // (the relay's loader page had none) WebKit reports every `env(safe-area-inset-*)` as 0.
        config.userContentController.addUserScript(WKUserScript(source: """
            const m = document.querySelector('meta[name=viewport]');
            if (m) m.content += ', viewport-fit=cover, maximum-scale=1, user-scalable=no';
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        // rove-web keeps `<meta name="theme-color">` on its background (prefs-apply.ts); report it and every change.
        config.userContentController.addUserScript(WKUserScript(source: """
            const post = () => {
              const m = document.querySelector('meta[name=theme-color]');
              if (m) window.webkit.messageHandlers.page.postMessage(m.content);
            };
            new MutationObserver(post).observe(document.head, { subtree: true, childList: true, attributes: true });
            post();
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController.add(context.coordinator, name: "page")
        config.setURLSchemeHandler(DemoSchemeHandler(), forURLScheme: DemoWeb.scheme)
        // rove-web's `haptic.ts`: a press in the page is felt like one on a native control.
        config.userContentController.add(context.coordinator, name: "haptic")
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        web.isOpaque = false
        web.backgroundColor = Theme.paperUI
        web.scrollView.backgroundColor = Theme.paperUI
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        web.isInspectable = true
        #endif
        // A hidden way back to the native computer list from inside the page: two fingers, held.
        let hold = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.held(_:)))
        hold.numberOfTouchesRequired = 2
        hold.minimumPressDuration = 0.8
        hold.cancelsTouchesInView = false
        hold.delegate = context.coordinator
        web.addGestureRecognizer(hold)
        context.coordinator.load(web)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        let c = context.coordinator
        let changed = c.parent.computer != computer || c.parent.reloadToken != reloadToken
        if c.parent.computer != computer { c.failingSince = nil }
        c.parent = self
        if changed { c.load(web) }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIGestureRecognizerDelegate {
        var parent: WebShellView
        /// When loads began failing; cleared by a load that lands. Back from the background the network often
        /// isn't up for the first load, so failures shorter than `failGrace` retry quietly instead of showing.
        var failingSince: Date?
        private static let failGrace: TimeInterval = 8

        init(_ parent: WebShellView) { self.parent = parent }

        func load(_ web: WKWebView) {
            parent.onFail(nil)
            // Always the paired link, fragment included: rove-web re-reads the token from it, so a page whose
            // storage was cleared signs back in without the user re-pairing.
            web.load(URLRequest(url: parent.computer.url))
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? String else { return }
            if message.name == "page" {
                guard let color = Theme.css(body) else { return }
                message.webView?.underPageBackgroundColor = color
                message.webView?.scrollView.backgroundColor = color
                parent.onPage(color)
            } else {
                Haptic.play(body)
            }
        }

        private func sameOrigin(_ url: URL) -> Bool {
            ShellComputer(url: url).origin == parent.computer.origin
        }

        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            // Subframes (the preview / browser panel) load whatever they load; only the page itself stays home.
            let mainFrame = action.targetFrame?.isMainFrame ?? true
            if mainFrame, ["http", "https"].contains(url.scheme?.lowercased() ?? ""), !sameOrigin(url) {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        /// `window.open` / `target=_blank`: the page's own origin stays in the app, anything else goes to Safari.
        func webView(_ web: WKWebView, createWebViewWith config: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if sameOrigin(url) { web.load(action.request) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        /// Hold-to-talk: the page's own origin gets the mic; iOS still asks the user once (NSMicrophoneUsageDescription).
        func webView(_ web: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let home = parent.computer.url
            let mine = origin.host == home.host && origin.protocol == home.scheme
            decisionHandler(mine && type == .microphone ? .grant : .prompt)
        }

        func webView(_ web: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            let since = failingSince ?? Date()
            failingSince = since
            if Date().timeIntervalSince(since) >= Self.failGrace { return parent.onFail(error.localizedDescription) }
            let url = parent.computer.url
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak web] in
                if let web, self.parent.computer.url == url { web.load(URLRequest(url: url)) }
            }
        }

        func webView(_ web: WKWebView, didFinish nav: WKNavigation!) { failingSince = nil }

        func webViewWebContentProcessDidTerminate(_ web: WKWebView) { load(web) }

        @objc func held(_ g: UILongPressGestureRecognizer) {
            if g.state == .began { parent.onSwitch() }
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}
