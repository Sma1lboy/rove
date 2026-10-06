import XCTest
@testable import RoveMobile

final class DemoFixtureTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func answer(_ json: String, _ op: String, _ args: [String: Any] = [:]) throws -> [String: Any] {
        let data = try DemoFixture(data: Data(json.utf8)).answer(op, args, now: now)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testRelativeTimesResolveAgainstNow() throws {
        let r = try answer(#"{"op": {"past": {"$ago_min": 5}, "future": {"$in_min": 60}, "ms": {"$ago_min": 1.5, "$as": "ms"}, "text": {"$b64": "hi"}}}"#, "op")
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        XCTAssertEqual(f.date(from: r["past"] as? String ?? "")?.timeIntervalSince1970, 1_800_000_000 - 300)
        XCTAssertEqual(f.date(from: r["future"] as? String ?? "")?.timeIntervalSince1970, 1_800_000_000 + 3600)
        XCTAssertEqual((r["ms"] as? NSNumber)?.int64Value, 1_800_000_000_000 - 90_000)
        XCTAssertEqual(r["text"] as? String, "aGk=")
    }

    func testByPicksOnArgsThenFallsBack() throws {
        let json = #"{"a": {"$by": ["taskId", "tabId"], "T1:tab-1": {"hit": 1}, "*": {"hit": 0}}, "b": {"$same_as": "a"}}"#
        XCTAssertEqual(try answer(json, "a", ["taskId": "T1", "tabId": "tab-1"])["hit"] as? Int, 1)
        XCTAssertEqual(try answer(json, "a", ["taskId": "T1", "tabId": "tab-9"])["hit"] as? Int, 0)
        XCTAssertEqual(try answer(json, "b", ["taskId": "T1", "tabId": "tab-1"])["hit"] as? Int, 1)
        XCTAssertTrue(try answer(json, "unnamed").isEmpty, "an op the fixture does not name answers {}")
    }

    /// The bundled fixture is what the reviewer sees: every list it serves must lead to a screen that has data.
    func testBundledFixtureCoversEveryScreenItLinksTo() throws {
        let fixture = try XCTUnwrap(DemoFixture.bundled(), "demo-fixture.json is not in the app bundle")
        func decode<T: Decodable>(_ op: String, _ args: [String: Any] = [:], as _: T.Type) throws -> T {
            try IncomingFrame.decode(T.self, from: fixture.answer(op, args))
        }
        let list = try decode("tasks.list", as: TasksPayload.self)
        XCTAssertFalse(list.tasks.isEmpty)
        XCTAssertTrue(list.attention.contains { $0.unread }, "the inbox needs something to show")
        for task in list.tasks {
            let tabs = try decode("task.tabs", ["taskId": task.id], as: TabsResult.self).tabs
            XCTAssertFalse(tabs.isEmpty, "\(task.id) has no tabs")
            for tab in tabs {
                let attach = try decode("term.attach", ["taskId": task.id, "tabId": tab.id], as: TermAttachResult.self)
                XCTAssertGreaterThan(Data(base64Encoded: attach.replay)?.count ?? 0, 0, "\(task.id)/\(tab.id) replays nothing")
            }
            for file in try decode("diff.files", ["taskId": task.id], as: DiffFilesResult.self).files {
                let diff = try decode("diff.file", ["taskId": task.id, "path": file.path, "scope": file.scope], as: DiffFileResult.self)
                XCTAssertEqual(diff.kind, "diff")
                XCTAssertTrue(diff.text?.contains("@@") == true, "\(task.id) \(file.path) has no hunk")
                XCTAssertEqual(DiffFileState.counts(diff.text ?? "").added, file.added, "\(file.path) list and diff disagree")
            }
        }
    }
}
