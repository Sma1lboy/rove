import XCTest
@testable import RoveMobile

final class GateTests: XCTestCase {
    private static let json = #"""
    {"tasks":[],"attention":[
      {"taskId":"T1","tabId":null,"state":"decision_needed","unread":true,"at":5,"gateId":"g-7"},
      {"taskId":"T1","tabId":"tab-2","state":"turn_complete","unread":true,"at":6}],
     "gates":[{"id":"g-7","taskId":"T1","tabId":null,"question":"Which approach?",
       "options":[{"key":"a","label":"Rewrite","detail":"2 days"},{"key":"b","label":"Patch"}],
       "recommended":"b","status":"open","createdAt":"2026-10-12T00:00:00.000Z","label":"Nightly loop"}]}
    """#

    private func payload(_ text: String = GateTests.json) throws -> TasksPayload {
        try JSONDecoder().decode(TasksPayload.self, from: Data(text.utf8))
    }

    func testGatesDecodeAndAnOlderBridgeWithoutThemMeansNone() throws {
        let p = try payload()
        let gate = try XCTUnwrap(p.gates.first)
        XCTAssertEqual(gate.options.map(\.key), ["a", "b"])
        XCTAssertEqual(gate.options.first?.detail, "2 days")
        XCTAssertEqual(gate.recommended, "b")
        XCTAssertTrue(gate.isOpen)
        XCTAssertEqual(p.attention.first?.gateId, "g-7")
        XCTAssertNil(p.attention.last?.gateId)
        XCTAssertEqual(try payload(#"{"tasks":[],"attention":[]}"#).gates, [])
    }

    func testADecisionRowIsKeyedByItsGateAndIsBlocking() throws {
        let row = try XCTUnwrap(payload().attention.first)
        XCTAssertEqual(InboxLogic.key(row), "gate\u{0}g-7")
        var other = row
        other.gateId = "g-8"
        XCTAssertNotEqual(InboxLogic.key(row), InboxLogic.key(other))
        XCTAssertTrue(InboxLogic.isBlocking(row))
        XCTAssertEqual(InboxLogic.glyph("decision_needed"), "?")
        XCTAssertEqual(InboxLogic.stateWord("decision_needed"), "decision")
    }

    @MainActor
    func testTheStoreResolvesARowToItsGateAndDropsGatesWithTheSnapshot() throws {
        let store = TaskStore(client: BridgeClient())
        store.apply(try payload())
        let row = try XCTUnwrap(store.attention.first)
        XCTAssertEqual(store.gate(for: row)?.question, "Which approach?")
        var missing = row
        missing.gateId = "g-9"
        XCTAssertNil(store.gate(for: missing))
        XCTAssertNil(store.gate(for: try XCTUnwrap(store.attention.last)))

        store.apply(TasksPayload(tasks: [], attention: []))
        XCTAssertNil(store.gate(for: row))
    }

    func testAnAnsweredGateIsNotOpen() throws {
        let p = try payload(#"{"gates":[{"id":"g-1","taskId":"T","question":"q","status":"answered","handoff":"undelivered"}]}"#)
        let gate = try XCTUnwrap(p.gates.first)
        XCTAssertFalse(gate.isOpen)
        XCTAssertEqual(gate.options, [])
        XCTAssertEqual(gate.handoff, "undelivered")
    }

    func testTheAnswerReplyReportsWhetherTheEngineTookItNow() throws {
        let decode = { (s: String) in try JSONDecoder().decode(GateAnswerResult.self, from: Data(s.utf8)).delivered }
        XCTAssertTrue(try decode(#"{"delivered":true}"#))
        XCTAssertFalse(try decode(#"{"delivered":false}"#))
        XCTAssertFalse(try decode("{}"))
    }
}
