import XCTest
@testable import RoveMobile

final class PairingTests: XCTestCase {
    let token = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_-"

    private func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics)! }

    func testPlainWebSocketURLStripsToken() throws {
        let p = try PairingParser.parse("ws://192.168.1.5:7788/?token=\(token)")
        XCTAssertEqual(p.token, token)
        XCTAssertEqual(p.preset, .direct)
        XCTAssertEqual(p.endpoint.absoluteString, "ws://192.168.1.5:7788/")
    }

    func testWhitespaceAndNewlinesAreTrimmed() throws {
        let p = try PairingParser.parse("  \n ws://mac.local:9/?token=\(token) \t\n")
        XCTAssertEqual(p.token, token)
        XCTAssertEqual(p.endpoint.host, "mac.local")
    }

    func testTailscalePresetOverWS() throws {
        let p = try PairingParser.parse("ws://100.64.0.1:7878/?token=\(token)&preset=tailscale")
        XCTAssertEqual(p.preset, .tailscale)
        XCTAssertEqual(p.endpoint.absoluteString, "ws://100.64.0.1:7878/")
    }

    func testTailscaleServeOverWSS() throws {
        let p = try PairingParser.parse("wss://mac.tail1234.ts.net/?preset=tailscale&token=\(token)")
        XCTAssertEqual(p.preset, .tailscale)
        XCTAssertEqual(p.endpoint.absoluteString, "wss://mac.tail1234.ts.net/")
        XCTAssertEqual(p.token, token)
    }

    func testCloudflarePreset() throws {
        let p = try PairingParser.parse("wss://rove.example.com/?token=\(token)&preset=cf")
        XCTAssertEqual(p.preset, .cloudflare)
        XCTAssertEqual(p.endpoint.absoluteString, "wss://rove.example.com/")
    }

    func testExplicitNonePreset() throws {
        XCTAssertEqual(try PairingParser.parse("ws://h:1/?token=\(token)&preset=none").preset, .direct)
    }

    func testRoveDeepLinkForEveryForm() throws {
        let inner = "wss://rove.example.com/?token=\(token)&preset=cf"
        let p = try PairingParser.parse("rove://pair?url=\(enc(inner))")
        XCTAssertEqual(p.preset, .cloudflare)
        XCTAssertEqual(p.token, token)
        XCTAssertEqual(p.endpoint.absoluteString, "wss://rove.example.com/")
        let legacy = try PairingParser.parse("rove://pair?url=\(enc("ws://100.64.0.1:7788/?token=\(token)"))")
        XCTAssertEqual(legacy.preset, .direct)
        XCTAssertEqual(legacy.endpoint.port, 7788)
    }

    func testOtherQueryItemsSurvive() throws {
        let p = try PairingParser.parse("ws://h:1/?x=1&token=\(token)")
        XCTAssertEqual(p.endpoint.absoluteString, "ws://h:1/?x=1")
    }

    func testRejections() {
        func code(_ s: String) -> PairingError? {
            do { _ = try PairingParser.parse(s); return nil } catch { return error as? PairingError }
        }
        XCTAssertEqual(code("ws://host:1/"), .missingToken)
        XCTAssertEqual(code("ws://host:1/?token="), .missingToken)
        XCTAssertEqual(code("rove://pair?url=\(enc("ws://h:1/"))"), .missingToken)
        XCTAssertEqual(code("ws://h:1/?token=\(token)&preset=wireguard"), .unknownPreset)
        XCTAssertEqual(code("ws://h:1/?token=\(token)&preset="), .unknownPreset)
        XCTAssertEqual(code("ws://rove.example.com/?token=\(token)&preset=cf"), .cloudflareNeedsTLS)
        XCTAssertEqual(code("rove://pair?url=\(enc("ws://h:1/?token=\(token)&preset=cf"))"), .cloudflareNeedsTLS)
        XCTAssertEqual(code("   "), .empty)
        XCTAssertEqual(code("http://h:1/?token=x"), .unsupportedScheme)
        XCTAssertEqual(code("rove://other?url=x"), .invalidURL)
        XCTAssertNotNil(code("not a url"))
    }

    func testCloudflareNeedsBothAccessCredentials() throws {
        var p = try PairingParser.parse("wss://rove.example.com/?token=\(token)&preset=cf")
        XCTAssertThrowsError(try p.validate()) { XCTAssertEqual($0 as? PairingError, .missingAccessCredentials) }
        p.cfAccessClientId = "id.access"
        XCTAssertFalse(p.isComplete)
        p.cfAccessClientSecret = "  "
        XCTAssertFalse(p.isComplete)
        p.cfAccessClientSecret = "s3cret"
        XCTAssertTrue(p.isComplete)
    }
}

final class ConnectRequestTests: XCTestCase {
    private func pairing(_ url: String, headers: [String: String] = [:]) throws -> Pairing {
        var p = try PairingParser.parse(url)
        p.customHeaders = headers
        return p
    }

    func testBearerHeaderAndNoTokenOrPresetInURL() throws {
        let req = makeConnectRequest(try pairing("wss://h.example/?token=TOK&preset=tailscale"))
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer TOK")
        XCTAssertEqual(req.url?.absoluteString, "wss://h.example/")
        XCTAssertFalse(req.url!.absoluteString.contains("TOK"))
        XCTAssertNil(req.value(forHTTPHeaderField: "CF-Access-Client-Id"))
    }

    func testEvenAHandBuiltPairingNeverPutsTokenInURL() {
        let p = Pairing(endpoint: URL(string: "ws://h:1/?token=LEAK&preset=cf&keep=1")!, token: "TOK")
        let url = makeConnectRequest(p).url!.absoluteString
        XCTAssertEqual(url, "ws://h:1/?keep=1")
    }

    func testCloudflareHeaders() throws {
        var p = try pairing("wss://rove.example.com/?token=TOK&preset=cf")
        p.cfAccessClientId = " 0123abcd.access "
        p.cfAccessClientSecret = "shh"
        let req = makeConnectRequest(p)
        XCTAssertEqual(req.value(forHTTPHeaderField: "CF-Access-Client-Id"), "0123abcd.access")
        XCTAssertEqual(req.value(forHTTPHeaderField: "CF-Access-Client-Secret"), "shh")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer TOK")
    }

    func testCloudflareHeadersOnlyForCloudflarePreset() throws {
        var p = try pairing("ws://h:1/?token=TOK")
        p.cfAccessClientId = "id"; p.cfAccessClientSecret = "secret"
        XCTAssertNil(makeConnectRequest(p).value(forHTTPHeaderField: "CF-Access-Client-Id"))
    }

    func testCustomHeadersApplyButCannotOverrideAuthorization() throws {
        let req = makeConnectRequest(try pairing("ws://h:1/?token=TOK",
            headers: ["X-Proxy-Key": "k1", "authorization": "Bearer EVIL", "Authorization": "Bearer EVIL2", "  ": "x"]))
        XCTAssertEqual(req.value(forHTTPHeaderField: "X-Proxy-Key"), "k1")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer TOK")
    }

    func testStoredBlobRoundTripsEverything() throws {
        var p = try PairingParser.parse("wss://rove.example.com/?token=TOK&preset=cf")
        p.customHeaders = ["X-A": "1", "X-B": "two words"]
        p.cfAccessClientId = "id.access"; p.cfAccessClientSecret = "secret"
        let blob = try XCTUnwrap(KeychainStore.encode(p))
        XCTAssertEqual(KeychainStore.decode(blob), p)
        XCTAssertEqual(KeychainStore.decode(blob)?.customHeaders["X-B"], "two words")
    }

    func testKeychainRoundTripWhenAvailable() throws {
        let store = KeychainStore(service: "run.rove.mobile.tests", account: UUID().uuidString)
        var p = try PairingParser.parse("wss://rove.example.com/?token=TOK&preset=cf")
        p.customHeaders = ["X-A": "1"]; p.cfAccessClientId = "id"; p.cfAccessClientSecret = "sec"
        guard store.save(p) else { throw XCTSkip("Keychain unavailable in this test host") }
        defer { store.delete() }
        XCTAssertEqual(store.load(), p)
        store.delete()
        XCTAssertNil(store.load())
    }

    func testUnauthorizedMessageHasNoSecrets() {
        XCTAssertTrue(ConnectRequest.unauthorizedMessage.contains("401"))
        XCTAssertFalse(ConnectRequest.unauthorizedMessage.contains("TOK"))
    }
}
