import XCTest
@testable import RoveMobile

final class ProtocolTests: XCTestCase {
    private func result<T: Decodable>(_ json: String, as: T.Type) throws -> T {
        guard case .response(_, .success(let d))? = IncomingFrame.parse(Data(json.utf8)) else {
            XCTFail("not a success response: \(json)"); throw BridgeError.malformed
        }
        return try IncomingFrame.decode(T.self, from: d)
    }

    func testErrorResponse() {
        let f = IncomingFrame.parse(Data(#"{"id":4,"ok":false,"error":{"code":"DIRTY_WORKTREE","message":"dirty"}}"#.utf8))
        XCTAssertEqual(f, .response(id: 4, result: .failure(BridgeError(code: "DIRTY_WORKTREE", message: "dirty"))))
    }

    func testGarbageFrameIgnored() { XCTAssertNil(IncomingFrame.parse(Data("nope".utf8))) }

    func testHello() throws {
        let h = try result(#"{"id":1,"ok":true,"result":{"protocol":1,"roveVersion":"1.2.3","host":"mac"}}"#, as: HelloResult.self)
        XCTAssertEqual(h, HelloResult(protocolVersion: 1, roveVersion: "1.2.3", host: "mac"))
    }

    static let tasksJSON = #"""
    {"id":2,"ok":true,"result":{"tasks":[
      {"id":"t1","title":"Fix","branch":"fix/x","repo":"/r/app","kind":"task","status":"in-progress","group":"waiting-on-you","rank":0,
       "activity":{"state":"waiting","forMs":125000},"engine":{"id":"e1","name":"Alpha"},
       "pr":{"number":12,"url":"https://x/12","lifecycle":"open","checkState":"passing","reviewDecision":"APPROVED"},
       "report":{"summary":"done","at":"2026-01-02T03:04:05Z"},"deleting":false},
      {"id":"t2","title":"","branch":"b","repo":"/r/app","kind":"main","status":"","group":"brand-new-group","rank":5,
       "activity":null,"engine":null,"pr":null,"report":null,"deleting":true}
    ],"attention":[{"taskId":"t1","tabId":null,"state":"waiting","unread":true,"at":1700000000000}]}}
    """#

    func testTasksResultAndUnknownGroup() throws {
        let p = try result(Self.tasksJSON, as: TasksPayload.self)
        XCTAssertEqual(p.tasks.count, 2)
        let t = p.tasks[0]
        XCTAssertEqual(t.group, .waitingOnYou)
        XCTAssertEqual(t.activity, TaskActivity(state: "waiting", forMs: 125000))
        XCTAssertEqual(t.engine?.name, "Alpha")
        XCTAssertEqual(t.pr?.number, 12)
        XCTAssertEqual(t.pr?.checkState, "passing")
        XCTAssertEqual(t.report?.summary, "done")
        XCTAssertEqual(t.report?.at, "2026-01-02T03:04:05Z")
        XCTAssertEqual(p.tasks[1].group, .unknown)
        XCTAssertNil(p.tasks[1].engine)
        XCTAssertTrue(p.tasks[1].deleting)
        XCTAssertEqual(p.attention, [AttentionItem(taskId: "t1", tabId: nil, state: "waiting", unread: true, at: 1700000000000)])
    }

    func testTasksPushEventDecodes() throws {
        let raw = #"{"event":"tasks","data":{"tasks":[],"attention":[]}}"#
        guard case .event(let name, let data)? = IncomingFrame.parse(Data(raw.utf8)),
              case .tasks(let p)? = BridgeEvent.from(name: name, data: data) else { return XCTFail() }
        XCTAssertTrue(p.tasks.isEmpty)
    }

    /// Additive protocol rule: a newer bridge may add optional fields and push events.
    /// This build must decode the rows it knows and ignore the rest, not drop the frame.
    func testNewerBridgeExtrasAreIgnored() throws {
        let rows = #"""
        {"id":5,"ok":true,"result":{"tasks":[{"id":"t1","title":"x","group":"working","rank":0,
          "activity":{"state":"running","forMs":5,"since":1,"phase":"tool"},"pinned":true,
          "changes":{"added":1,"deleted":0},"rowTokens":[{"text":"ci"}],"futureThing":{"a":[1]}}],
          "attention":[],"cursor":"next"}}
        """#
        let p = try result(rows, as: TasksPayload.self)
        XCTAssertEqual(p.tasks.first?.activity, TaskActivity(state: "running", forMs: 5))
        let push = #"{"event":"notice","data":{"title":"done"}}"#
        guard case .event(let name, let data)? = IncomingFrame.parse(Data(push.utf8)) else { return XCTFail() }
        XCTAssertNil(BridgeEvent.from(name: name, data: data), "an unknown push event is dropped, not misread")
    }

    func testEnginesReposCreate() throws {
        let e = try result(#"{"id":3,"ok":true,"result":{"engines":[{"id":"a","name":"Alpha","command":"alpha","protocol":"pty","builtin":true}]}}"#, as: EnginesResult.self)
        XCTAssertEqual(e.engines.first, Engine(id: "a", name: "Alpha", command: "alpha", protocolName: "pty", builtin: true))
        XCTAssertEqual(try result(#"{"id":3,"ok":true,"result":{"repos":["/a","/b"]}}"#, as: ReposResult.self).repos, ["/a", "/b"])
        XCTAssertEqual(try result(#"{"id":3,"ok":true,"result":{"taskId":"t9"}}"#, as: TaskCreateResult.self).taskId, "t9")
    }

    func testDeleteLandTabs() throws {
        XCTAssertEqual(try result(#"{"id":1,"ok":true,"result":{"status":"deleting"}}"#, as: TaskDeleteResult.self).status, "deleting")
        let l = try result(#"{"id":1,"ok":true,"result":{"landedOn":"main","commit":"abc123"}}"#, as: TaskLandResult.self)
        XCTAssertEqual(l.landedOn, "main"); XCTAssertEqual(l.commit, "abc123")
        let t = try result(#"{"id":1,"ok":true,"result":{"tabs":[{"id":"tab-1","kind":"engine","title":null,"engineName":"Alpha","alive":true,"engineAlive":null},{"id":"tab-2","kind":"shell","title":"zsh","engineName":null,"alive":null,"engineAlive":null}]}}"#, as: TabsResult.self)
        XCTAssertEqual(t.tabs[0].displayTitle, "Alpha")
        XCTAssertEqual(t.tabs[1].displayTitle, "zsh")
        XCTAssertEqual(try result(#"{"id":1,"ok":true,"result":{"tabId":"tab-3"}}"#, as: TabNewResult.self).tabId, "tab-3")
        _ = try result(#"{"id":1,"ok":true,"result":{}}"#, as: EmptyResult.self)
    }

    func testTermAttachAndEvents() throws {
        let a = try result(#"{"id":1,"ok":true,"result":{"stream":"s1","alive":true,"replay":"aGk="}}"#, as: TermAttachResult.self)
        XCTAssertEqual(a.stream, "s1")
        XCTAssertEqual(Data(base64Encoded: a.replay), Data("hi".utf8))

        guard case .event(let n, let d)? = IncomingFrame.parse(Data(#"{"event":"term.data","data":{"stream":"s1","data":"AQID"}}"#.utf8)),
              case .termData(let stream, let bytes)? = BridgeEvent.from(name: n, data: d) else { return XCTFail() }
        XCTAssertEqual(stream, "s1"); XCTAssertEqual(Array(bytes), [1, 2, 3])

        guard case .event(let n2, let d2)? = IncomingFrame.parse(Data(#"{"event":"term.exit","data":{"stream":"s1","code":null}}"#.utf8)),
              case .termExit(let s2, let code)? = BridgeEvent.from(name: n2, data: d2) else { return XCTFail() }
        XCTAssertEqual(s2, "s1"); XCTAssertNil(code)
    }

    func testDiffResults() throws {
        let f = try result(#"{"id":1,"ok":true,"result":{"base":null,"files":[{"path":"a.swift","status":"M","added":3,"deleted":null,"scope":"branch"},{"path":"b","status":"??","added":null,"deleted":null,"scope":"working"}]}}"#, as: DiffFilesResult.self)
        XCTAssertNil(f.base)
        XCTAssertEqual(f.files[0].added, 3)
        XCTAssertNil(f.files[0].deleted)
        XCTAssertEqual(f.files[1].scope, "working")
        let d = try result(#"{"id":1,"ok":true,"result":{"kind":"diff","text":"@@ -1 +1 @@\n-a\n+b"}}"#, as: DiffFileResult.self)
        XCTAssertEqual(d.kind, "diff"); XCTAssertEqual(d.text, "@@ -1 +1 @@\n-a\n+b")
        let b = try result(#"{"id":1,"ok":true,"result":{"kind":"binary","message":"Binary file"}}"#, as: DiffFileResult.self)
        XCTAssertEqual(b.message, "Binary file"); XCTAssertNil(b.text)
    }

    func testBackoffSchedule() {
        XCTAssertEqual((0..<8).map(Backoff.delay(attempt:)), [0.5, 1, 2, 4, 8, 15, 15, 15])
    }

    func testDiffLineClassification() {
        XCTAssertEqual(DiffLineKind.classify("+++ b/a"), .meta)
        XCTAssertEqual(DiffLineKind.classify("--- a/a"), .meta)
        XCTAssertEqual(DiffLineKind.classify("@@ -1 +1 @@"), .hunk)
        XCTAssertEqual(DiffLineKind.classify("+x"), .added)
        XCTAssertEqual(DiffLineKind.classify("-x"), .removed)
        XCTAssertEqual(DiffLineKind.classify(" x"), .context)
    }

    /// A `tasks` frame mixing an old-bridge row (no additive fields) with a new one: both decode,
    /// and the old row falls back to plain defaults.
    func testTasksFrameDecodesRowsWithAndWithoutAdditiveListFields() throws {
        let p = try result(#"""
        {"id":3,"ok":true,"result":{"tasks":[
          {"id":"old","title":"Old","group":"idle","rank":0},
          {"id":"new","title":"New","group":"working","rank":1,"pinned":true,"order":2,"updatedAt":"2026-07-01T00:00:00.000Z",
           "changes":{"added":1,"deleted":2,"ahead":3},"rowTokens":[{"text":"t","tone":"error","source":"s","expiresAt":1}],
           "prChip":"passing","prChipStale":false}],"attention":[]}}
        """#, as: TasksPayload.self)
        XCTAssertEqual(p.tasks.map(\.id), ["old", "new"])
        XCTAssertFalse(p.tasks[0].pinned); XCTAssertNil(p.tasks[0].changes); XCTAssertTrue(p.tasks[0].rowTokens.isEmpty)
        XCTAssertTrue(p.tasks[1].pinned); XCTAssertEqual(p.tasks[1].order, 2)
        XCTAssertEqual(p.tasks[1].changes?.ahead, 3); XCTAssertEqual(p.tasks[1].prChip, "passing")
    }
}
