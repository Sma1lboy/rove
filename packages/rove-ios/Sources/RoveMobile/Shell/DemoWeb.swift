import UniformTypeIdentifiers
import WebKit

/// The demo: rove-web built on canned answers (`rove-web/src/demo/`, copied in by `scripts/build-demo-web.sh`),
/// served from the app bundle under its own scheme. It makes no network request.
enum DemoWeb {
    static let scheme = "rove-demo"
    static let computer = ShellComputer(url: URL(string: "\(scheme)://app/")!)
}

final class DemoSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.bundleURL.appendingPathComponent("DemoWeb", isDirectory: true).standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let file = root.appendingPathComponent(url.path == "/" ? "demo.html" : url.path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            return task.didFailWithError(URLError(.fileDoesNotExist))
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count,
                                    textEncodingName: mime.hasPrefix("text/") ? "utf-8" : nil))
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
