import XCTest

extension XCUIElement {
    /// Focuses the field, deletes what it holds, types `text`.
    func clearAndType(_ text: String) {
        tap()
        let current = (value as? String) ?? ""
        if !current.isEmpty { typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count)) }
        typeText(text)
    }

    /// Whether this element is the first responder (XCUIElement's KVC `hasKeyboardFocus`).
    var hasFocus: Bool { (value(forKey: "hasKeyboardFocus") as? Bool) ?? false }
}

/// The software keyboard as the app's accessibility tree and the screen see it.
struct KeyboardProbe {
    let app: XCUIApplication

    /// The keyboard's frame, or nil. Read from one element snapshot: a keyboard that leaves between a count and a
    /// frame query is an XCUI "failed to get matching snapshot" failure, here it is just gone.
    var frame: CGRect? { (try? app.keyboards.firstMatch.snapshot())?.frame }

    /// A software keyboard on screen. With a hardware keyboard attached the tree can still hold a keyboard
    /// element, but not one that is tall and inside the app's frame.
    var isUp: Bool {
        guard let k = frame else { return false }
        let a = app.frame
        return k.height > 100 && k.minY > a.minY && k.maxY <= a.maxY + 1
    }

    /// The `keyboardDone` button on screen now (a presenter under a sheet can hold another, off screen).
    var done: XCUIElement? {
        app.buttons.matching(identifier: "keyboardDone").allElementsBoundByIndex.first { $0.exists && $0.isHittable }
    }

    /// Where the keyboard's backdrop starts on screen. XCUI's keyboard frame starts at the keys; the backdrop
    /// rises above them by an amount that depends on the keyboard (suggestion row or not). Scans up from the
    /// keys 24 pt in from the left edge (clear of the rounded corner) for the first color edge.
    func visibleTop(_ px: Pixels) -> CGFloat {
        guard let k = frame else { return px.upright.size.height }
        let x = k.minX + 24
        var y = k.minY + 1
        var below = px.rgb(CGPoint(x: x, y: y))
        while y > k.minY - 80 {
            let above = px.rgb(CGPoint(x: x, y: y - 0.5))
            if Pixels.distance(above, below) > 0.05 { return y }
            below = above
            y -= 0.5
        }
        return k.minY
    }

    /// Top edge of everything over the content: the app's `done` bar when shown, else the keyboard backdrop.
    func coveredTop(_ px: Pixels) -> CGFloat {
        let bar = app.descendants(matching: .any)["keyboardBar"].firstMatch
        let top = visibleTop(px)
        return bar.exists && bar.isHittable ? min(top, bar.frame.minY) : top
    }

    /// Up and no longer moving (two equal frames 0.25 s apart).
    @discardableResult
    func waitUp(timeout: TimeInterval = 6) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        var last: CGRect?
        while Date() < deadline {
            if isUp {
                let f = frame
                if let last, last == f { Thread.sleep(forTimeInterval: 0.4); return true }
                last = f
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return false
    }

    @discardableResult
    func waitDown(timeout: TimeInterval = 6) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !isUp { Thread.sleep(forTimeInterval: 0.6); return true }
            Thread.sleep(forTimeInterval: 0.15)
        }
        return false
    }
}

/// A screenshot as upright RGBA pixels addressed in app points. XCUIScreenshot keeps a landscape capture
/// as a portrait buffer plus an orientation flag; drawing it through UIKit applies the flag.
struct Pixels {
    let upright: UIImage
    private let buf: [UInt8]
    private let width: Int, height: Int
    private let scale: CGFloat

    init(_ shot: XCUIScreenshot) {
        let image = shot.image
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        upright = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(at: .zero) }
        let cg = upright.cgImage!
        width = cg.width; height = cg.height
        scale = CGFloat(width) / upright.size.width
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let ctx = CGContext(data: &data, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        buf = data
    }

    func rgb(_ p: CGPoint) -> SIMD3<Double> {
        let x = min(max(Int(p.x * scale), 0), width - 1), y = min(max(Int(p.y * scale), 0), height - 1)
        let i = (y * width + x) * 4
        return SIMD3(Double(buf[i]), Double(buf[i + 1]), Double(buf[i + 2])) / 255
    }

    /// Mean relative luminance (0 black … 1 white) of `rect`, in points.
    func luminance(in rect: CGRect) -> Double {
        var sum = 0.0, n = 0.0
        var y = rect.minY
        while y < rect.maxY {
            var x = rect.minX
            while x < rect.maxX {
                let c = rgb(CGPoint(x: x, y: y))
                sum += 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z
                n += 1
                x += 1
            }
            y += 1
        }
        return n == 0 ? -1 : sum / n
    }

    static func distance(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double {
        let d = a - b
        return (d * d).sum().squareRoot()
    }
}

/// What scripts/fixture-bridge.ts received, read back over its `/log` endpoint.
struct FixtureLog {
    let url: URL

    /// `ws://host:port/?token=fixture` → `http://host:port/log`.
    init?(socketURL: String) {
        guard var c = URLComponents(string: socketURL) else { return nil }
        c.scheme = c.scheme == "wss" ? "https" : "http"
        c.path = "/log"
        c.query = nil
        guard let u = c.url else { return nil }
        url = u
    }

    struct Entry { let op: String; let args: [String: Any] }

    private func call(_ method: String) -> [Entry] {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer fixture", forHTTPHeaderField: "Authorization")
        let done = DispatchSemaphore(value: 0)
        var body = Data()
        URLSession.shared.dataTask(with: req) { d, _, _ in body = d ?? Data(); done.signal() }.resume()
        _ = done.wait(timeout: .now() + 5)
        let rows = (try? JSONSerialization.jsonObject(with: body)) as? [[String: Any]] ?? []
        return rows.map { Entry(op: $0["op"] as? String ?? "", args: $0["args"] as? [String: Any] ?? [:]) }
    }

    func entries() -> [Entry] { call("GET") }
    func clear() { _ = call("DELETE") }

    /// The size the app last gave the PTY: the latest `term.resize`, else the `term.attach` size.
    func lastSize() -> (cols: Int, rows: Int)? {
        for e in entries().reversed() where e.op == "term.resize" || e.op == "term.attach" {
            if let c = e.args["cols"] as? Int, let r = e.args["rows"] as? Int { return (c, r) }
        }
        return nil
    }

    /// Everything sent with `term.input`, in order, joined.
    func input() -> String { entries().filter { $0.op == "term.input" }.compactMap { $0.args["data"] as? String }.joined() }
}
