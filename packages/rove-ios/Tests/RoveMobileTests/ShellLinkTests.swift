import XCTest
@testable import RoveMobile

/// Every link the bridge prints (`auth.ts`: `webUrl`, `relayLink`, `pairingUrl`) opens the right rove-web page.
final class ShellLinkTests: XCTestCase {
    let token = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_-"

    private func page(_ link: String) throws -> String { try ShellLink.parse(link).url.absoluteString }

    func testWebLinksLoadAsIs() throws {
        XCTAssertEqual(try page("http://127.0.0.1:7878/#token=\(token)"), "http://127.0.0.1:7878/#token=\(token)")
        XCTAssertEqual(try page("https://rove.example.com/#token=\(token)"), "https://rove.example.com/#token=\(token)")
        XCTAssertEqual(try page("http://[fd7a:115c::1]:7878/#token=\(token)"), "http://[fd7a:115c::1]:7878/#token=\(token)")
        // An `open`-mode or password-mode bare address: the page signs in on its own.
        XCTAssertEqual(try page("  http://mac.local:7878/\n"), "http://mac.local:7878/")
    }

    func testRelayLinkKeepsCodeAndToken() throws {
        let link = "https://relay.example.workers.dev/#code=CODE_1-x&token=\(token)"
        XCTAssertEqual(try page(link), link)
    }

    func testSocketPairLinksBecomeThePageOnTheSameHost() throws {
        XCTAssertEqual(try page("ws://192.168.1.5:7878/?token=\(token)"), "http://192.168.1.5:7878/#token=\(token)")
        XCTAssertEqual(try page("ws://100.64.0.1:7878/?token=\(token)&preset=tailscale"), "http://100.64.0.1:7878/#token=\(token)")
        XCTAssertEqual(try page("wss://mac.tail1234.ts.net/?preset=tailscale&token=\(token)"), "https://mac.tail1234.ts.net/#token=\(token)")
        XCTAssertEqual(try page("wss://rove.example.com/?token=\(token)&preset=cf"), "https://rove.example.com/#token=\(token)")
    }

    func testRoveDeepLinkWrapsAnyShape() throws {
        func wrap(_ s: String) -> String { "rove://pair?url=\(s.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!)" }
        XCTAssertEqual(try page(wrap("ws://h:1/?token=\(token)")), "http://h:1/#token=\(token)")
        XCTAssertEqual(try page(wrap("https://r.dev/#code=c&token=\(token)")), "https://r.dev/#code=c&token=\(token)")
    }

    func testOneEntryPerOrigin() throws {
        let a = try ShellLink.parse("ws://h:1/?token=\(token)")
        let b = try ShellLink.parse("http://h:1/#token=other")
        XCTAssertEqual(a.id, b.id)
        XCTAssertNotEqual(a.id, try ShellLink.parse("http://h:2/").id)
        XCTAssertEqual(a.display, "h:1")
    }

    func testRejections() {
        func code(_ s: String) -> PairingError? {
            do { _ = try ShellLink.parse(s); return nil } catch { return error as? PairingError }
        }
        XCTAssertEqual(code("   "), .empty)
        XCTAssertEqual(code("ws://h:1/"), .missingToken)
        XCTAssertEqual(code("ws://h:1/?token=\(token)&preset=bogus"), .unknownPreset)
        XCTAssertEqual(code("ftp://h/"), .unsupportedScheme)
        XCTAssertEqual(code("http:///#token=x"), .invalidURL)
        XCTAssertEqual(code("rove://other?url=x"), .invalidURL)
        XCTAssertEqual(code("rove://pair?url=rove%3A%2F%2Fpair"), .invalidURL)
    }
}
