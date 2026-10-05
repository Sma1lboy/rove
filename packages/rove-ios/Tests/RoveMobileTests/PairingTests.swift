import XCTest
@testable import RoveMobile

final class PairingTests: XCTestCase {
    let token = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_-"

    func testPlainWebSocketURL() throws {
        let p = try PairingParser.parse("ws://192.168.1.5:7788/?token=\(token)")
        XCTAssertEqual(p.token, token)
        XCTAssertEqual(p.host, "192.168.1.5")
        XCTAssertEqual(p.url.port, 7788)
        XCTAssertEqual(p.url.scheme, "ws")
    }

    func testWhitespaceAndNewlinesAreTrimmed() throws {
        let p = try PairingParser.parse("  \n ws://mac.local:9/?token=\(token) \t\n")
        XCTAssertEqual(p.token, token)
        XCTAssertEqual(p.host, "mac.local")
    }

    func testRoveDeepLinkWithPercentEncodedURL() throws {
        let inner = "ws://100.64.0.1:7788/?token=\(token)"
        let enc = inner.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        let p = try PairingParser.parse("rove://pair?url=\(enc)")
        XCTAssertEqual(p.token, token)
        XCTAssertEqual(p.host, "100.64.0.1")
        XCTAssertEqual(p.url.absoluteString, inner)
    }

    func testMissingTokenRejected() {
        XCTAssertThrowsError(try PairingParser.parse("ws://host:1/")) { XCTAssertEqual($0 as? PairingError, .missingToken) }
        XCTAssertThrowsError(try PairingParser.parse("ws://host:1/?token=")) { XCTAssertEqual($0 as? PairingError, .missingToken) }
        let enc = "ws://h:1/".addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        XCTAssertThrowsError(try PairingParser.parse("rove://pair?url=\(enc)")) { XCTAssertEqual($0 as? PairingError, .missingToken) }
    }

    func testOtherInputsRejected() {
        XCTAssertThrowsError(try PairingParser.parse("   ")) { XCTAssertEqual($0 as? PairingError, .empty) }
        XCTAssertThrowsError(try PairingParser.parse("http://h:1/?token=x")) { XCTAssertEqual($0 as? PairingError, .unsupportedScheme) }
        XCTAssertThrowsError(try PairingParser.parse("rove://other?url=x")) { XCTAssertEqual($0 as? PairingError, .invalidURL) }
        XCTAssertThrowsError(try PairingParser.parse("not a url")) 
    }
}
