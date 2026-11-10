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

    func testAnUnreportedTickIsClearedOnlyByAnExplicitDismiss() throws {
        func item(_ state: String, gate: String? = nil) throws -> AttentionItem {
            let extra = gate.map { #","gateId":"\#($0)""# } ?? ""
            return try JSONDecoder().decode(AttentionItem.self, from: Data(#"{"taskId":"T1","tabId":"tab-1","state":"\#(state)","unread":true,"at":1\#(extra)}"#.utf8))
        }
        XCTAssertFalse(InboxLogic.clearsOnVisit(try item("report_missing")))
        XCTAssertFalse(InboxLogic.clearsOnVisit(try item("decision_needed", gate: "g-1")))
        XCTAssertTrue(InboxLogic.clearsOnVisit(try item("turn_complete")))
        XCTAssertTrue(InboxLogic.clearsOnVisit(try item("error")))
    }

    func testADismissalNamesWhatTheEpisodeIsKeyedOn() {
        func dismissal(_ item: AttentionItem) -> String? {
            InboxLogic.dismissal(item).map { "\($0.op) \($0.args.sorted { $0.key < $1.key }.map(\.value))" }
        }
        var routine = AttentionItem(state: "routine_failed", unread: true, at: 1)
        XCTAssertNil(dismissal(routine), "an older bridge sends no routine id")
        routine.automationId = "r-1"
        XCTAssertEqual(dismissal(routine), "attention.dismissRoutine [\"r-1\"]")
        XCTAssertEqual(dismissal(AttentionItem(taskId: "T1", state: "report_missing", unread: true, at: 1, deliveryId: "d-1")),
                       "attention.dismiss [\"d-1\", \"T1\"]")
        XCTAssertNil(dismissal(AttentionItem(taskId: "T1", state: "decision_needed", unread: true, at: 1, gateId: "g-1")))
    }
}
