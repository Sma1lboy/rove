import XCTest
@testable import RoveMobile

final class TaskActionsTests: XCTestCase {
    private typealias L = TaskActionLogic

    private func decode<T: Decodable>(_ json: String, as: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private func detail(prompt: String? = "do the thing", path: String = "/wt/a", kind: String = "task",
                        engine: String? = "codex", command: String? = nil, title: String = "Fix it") throws -> TaskDetail {
        var o: [String: Any] = ["id": "t1", "title": title, "repo": "/r/app", "branch": "fix/x", "worktreePath": path,
                                "kind": kind, "status": "in_progress"]
        if let prompt { o["prompt"] = prompt }
        if let engine { o["engine"] = engine }
        if let command { o["command"] = command }
        return try JSONDecoder().decode(TaskDetail.self, from: JSONSerialization.data(withJSONObject: o))
    }

    private func engine(_ id: String, command: String? = nil, models: [EngineModel]? = nil, effort: [String]? = nil) -> Engine {
        Engine(id: id, name: id.capitalized, command: command ?? id, protocolName: id, builtin: true, models: models, effortLevels: effort)
    }

    // MARK: delete plans

    func testDeletePlanByKind() {
        let main = L.deletePlan(kind: "main")
        XCTAssertEqual(main.flow, .forgetProject)
        XCTAssertEqual(main.flow.op, "project.forget")
        XCTAssertNil(main.forceToggleLabel)
        XCTAssertFalse(main.retriesWithForce)
        XCTAssertTrue(main.body.contains("stay on disk"))

        let dir = L.deletePlan(kind: "dir")
        XCTAssertEqual(dir.flow.op, "task.delete")
        XCTAssertNil(dir.forceToggleLabel)
        XCTAssertFalse(dir.retriesWithForce)
        XCTAssertTrue(dir.dialogMessage.contains("directory stays"))

        for kind in ["task", "", "worktree"] {
            let t = L.deletePlan(kind: kind)
            XCTAssertEqual(t.flow, .deleteTask)
            XCTAssertEqual(t.flow.op, "task.delete")
            XCTAssertNotNil(t.forceToggleLabel)
            XCTAssertTrue(t.retriesWithForce)
            XCTAssertEqual(t.dialogButton, "Delete…")
            XCTAssertEqual(t.menuTitle, "Delete task")
        }
        XCTAssertEqual(L.removeWorktreePlan().flow.op, "task.removeWorktree")
        XCTAssertTrue(L.removeWorktreePlan().body.contains("task and its git branch stay"))
    }

    func testArgsForceOnlyWhereItRetries() {
        let del = L.deletePlan(kind: "task")
        XCTAssertEqual(L.args(for: del, taskId: "t1", repo: nil, force: false) as NSDictionary, ["taskId": "t1"])
        XCTAssertEqual(L.args(for: del, taskId: "t1", repo: nil, force: true) as NSDictionary, ["taskId": "t1", "force": true])
        // A directory entry has no worktree to force.
        XCTAssertEqual(L.args(for: L.deletePlan(kind: "dir"), taskId: "t1", repo: nil, force: true) as NSDictionary, ["taskId": "t1"])
        XCTAssertEqual(L.args(for: L.deletePlan(kind: "main"), taskId: "t1", repo: "/r/app", force: true) as NSDictionary, ["repo": "/r/app"])
        XCTAssertEqual(L.args(for: L.removeWorktreePlan(), taskId: "t1", repo: nil, force: true) as NSDictionary, ["taskId": "t1", "force": true])
    }

    func testDirtyRefusalDetection() {
        XCTAssertTrue(L.isDirtyRefusal(BridgeError(code: "DIRTY_WORKTREE", message: "x")))
        XCTAssertTrue(L.isDirtyRefusal(BridgeError(code: "RPC_ERROR", message: "DIRTY_WORKTREE: /wt has 2 changes")))
        XCTAssertTrue(L.isDirtyRefusal(BridgeError(code: "RPC_ERROR", message: "worktree has Uncommitted changes")))
        XCTAssertFalse(L.isDirtyRefusal(BridgeError(code: "NOT_FOUND", message: "no such task")))
        XCTAssertFalse(L.isDirtyRefusal(BridgeError.timeout))
        XCTAssertFalse(L.isDirtyRefusal(URLError(.badURL)))
    }

    func testDirtyDetailStripsCodePrefix() {
        let e = BridgeError(code: "RPC_ERROR", message: "DIRTY_WORKTREE: /wt/a has 2 uncommitted changes")
        XCTAssertEqual(L.dirtyDetail(e), "/wt/a has 2 uncommitted changes")
        XCTAssertEqual(L.dirtyDetail(BridgeError(code: "DIRTY_WORKTREE", message: "")), "the worktree holds uncommitted changes")
    }

    // MARK: status

    func testStatusLabelMapping() {
        XCTAssertEqual(L.statusLabel("in_progress"), .inProgress)
        XCTAssertEqual(L.statusLabel("in-progress"), .inProgress)
        XCTAssertEqual(L.statusLabel("In Review"), .inReview)
        XCTAssertEqual(L.statusLabel(" done "), .done)
        XCTAssertNil(L.statusLabel(""))
        XCTAssertNil(L.statusLabel("archived"))
        XCTAssertEqual(TaskStatusLabel.allCases.count, 6)
        XCTAssertEqual(TaskStatusLabel.inProgress.label, "in progress")
    }

    // MARK: engine / model / effort

    func testEngineLookupPrefersIdThenRowThenCommand() throws {
        let engines = [engine("claude", command: "claude"), engine("codex", command: "/usr/bin/codex --fast")]
        XCTAssertEqual(L.engine(detail: try detail(engine: "codex"), in: engines)?.id, "codex")
        XCTAssertEqual(L.engine(detail: try detail(engine: nil), rowEngineId: "claude", in: engines)?.id, "claude")
        XCTAssertEqual(L.engine(detail: try detail(engine: nil, command: "codex"), in: engines)?.id, "codex")
        XCTAssertEqual(L.engine(detail: try detail(engine: nil, command: "codex --other"), in: engines)?.id, "codex")
        XCTAssertNil(L.engine(detail: try detail(engine: "ghost"), in: engines))
        XCTAssertNil(L.engine(detail: nil, in: engines))
    }

    func testEffortAndModelOptionsFromEngine() {
        XCTAssertEqual(L.effortLevels(engine("pi", effort: ["low", "high", "low", ""])), ["low", "high"])
        XCTAssertEqual(L.effortLevels(engine("claude", effort: [])), [])
        XCTAssertEqual(L.effortLevels(engine("claude", effort: nil)), [])
        XCTAssertEqual(L.effortLevels(nil), [])

        let models = [EngineModel(id: "opus", name: "Opus"), EngineModel(id: "opus", name: nil), EngineModel(id: "", name: "x"), EngineModel(id: "sonnet", name: nil)]
        XCTAssertEqual(L.modelSuggestions(engine("claude", models: models)).map(\.id), ["opus", "sonnet"])
        XCTAssertEqual(L.modelSuggestions(engine("claude", models: nil)), [])
        XCTAssertEqual(L.modelSuggestions(nil), [])
    }

    func testInputValidation() {
        XCTAssertEqual(L.validTitle("  Fix it  "), "Fix it")
        XCTAssertNil(L.validTitle("   "))
        XCTAssertNil(L.validTitle(String(repeating: "a", count: 201)))
        XCTAssertNotNil(L.validTitle(String(repeating: "a", count: 200)))

        XCTAssertEqual(L.validBranch(" feat/new-thing "), "feat/new-thing")
        for bad in ["", "-x", "a b", "a..b", "a~1", "a^", "a:b", "a?b", "a*", "a[0]", "a\\b", "x.lock", "x/", "/x", "a//b", "a@{u}", "@", "x."] {
            XCTAssertNil(L.validBranch(bad), bad)
        }
    }

    // MARK: menu availability

    func testPinLabelFlips() {
        XCTAssertEqual(L.pinItem(pinned: false), .init(title: "Pin to top", symbol: "pin", next: true))
        XCTAssertEqual(L.pinItem(pinned: true), .init(title: "Unpin", symbol: "pin.slash", next: false))
        XCTAssertTrue(L.menu(kind: "task", pinned: true, branch: "b", detail: nil).pin.title == "Unpin")
    }

    func testMenuForMainHidesBranchMoveAndWorktree() throws {
        let m = L.menu(kind: "main", pinned: false, branch: "main", detail: try detail(kind: "main"))
        XCTAssertFalse(m.branch)
        XCTAssertFalse(m.move)
        XCTAssertFalse(m.createWorktree)
        XCTAssertFalse(m.removeWorktree)
        XCTAssertEqual(m.runAgain, .hidden)
        XCTAssertEqual(m.delete.flow, .forgetProject)
        XCTAssertTrue(m.copyBranch)
    }

    func testMenuForDirectoryEntry() {
        let m = L.menu(kind: "dir", pinned: false, branch: "", detail: nil)
        XCTAssertFalse(m.branch)
        XCTAssertTrue(m.move)
        XCTAssertFalse(m.createWorktree || m.removeWorktree)
        XCTAssertEqual(m.runAgain, .hidden)
        XCTAssertFalse(m.copyBranch)
        XCTAssertEqual(m.delete.flow, .removeEntry)
    }

    func testWorktreeItemsFollowThePath() throws {
        let with = L.menu(kind: "task", pinned: false, branch: "b", detail: try detail(path: "/wt/a"))
        XCTAssertTrue(with.removeWorktree); XCTAssertFalse(with.createWorktree); XCTAssertTrue(with.copyPath)

        let without = L.menu(kind: "task", pinned: false, branch: "b", detail: try detail(path: "  "))
        XCTAssertTrue(without.createWorktree); XCTAssertFalse(without.removeWorktree); XCTAssertFalse(without.copyPath)

        // Not fetched yet: offer both, the tap re-reads the truth.
        let unknown = L.menu(kind: "task", pinned: false, branch: "b", detail: nil)
        XCTAssertTrue(unknown.createWorktree); XCTAssertTrue(unknown.removeWorktree); XCTAssertTrue(unknown.copyPath)
        XCTAssertTrue(unknown.branch); XCTAssertTrue(unknown.move)
    }

    func testRunAgainAvailability() throws {
        XCTAssertEqual(L.runAgain(kind: "task", detail: try detail(prompt: "go")), .available)
        XCTAssertEqual(L.runAgain(kind: "task", detail: nil), .available)
        XCTAssertEqual(L.runAgain(kind: "task", detail: try detail(prompt: nil)), .unavailable("no stored prompt"))
        XCTAssertEqual(L.runAgain(kind: "task", detail: try detail(prompt: "  \n ")), .unavailable("no stored prompt"))
        XCTAssertEqual(L.runAgain(kind: "main", detail: try detail(prompt: "go")), .hidden)
    }

    func testRunAgainArgs() throws {
        let a = try XCTUnwrap(L.runAgainArgs(try detail(prompt: " go \n", engine: "codex", title: "Fix it")))
        XCTAssertEqual(a as NSDictionary, ["repo": "/r/app", "prompt": "go", "engine": "codex", "title": "Fix it"])
        let bare = try XCTUnwrap(L.runAgainArgs(try detail(prompt: "go", engine: nil, title: "")))
        XCTAssertEqual(bare as NSDictionary, ["repo": "/r/app", "prompt": "go"])
        XCTAssertNil(L.runAgainArgs(try detail(prompt: nil)))
    }

    func testRequestFirstStepsPromoteToSheetSteps() {
        typealias R = TaskActionHost.Request
        XCTAssertEqual(R.delete(taskId: "t").confirmed, .confirmDelete(taskId: "t"))
        XCTAssertEqual(R.removeWorktree(taskId: "t").confirmed, .confirmRemoveWorktree(taskId: "t"))
        XCTAssertEqual(R.forgetProject(repo: "/r").confirmed, .confirmForgetProject(repo: "/r"))
        XCTAssertNil(R.rename(taskId: "t").confirmed)
        XCTAssertNil(R.confirmDelete(taskId: "t").confirmed)
        XCTAssertNotEqual(R.delete(taskId: "t").id, R.confirmDelete(taskId: "t").id)
    }

    // MARK: info text

    func testInfoTextHelpers() throws {
        XCTAssertEqual(L.uncommittedLine(TaskInfoChanges(added: 12, deleted: 3)), "+12 −3")
        XCTAssertEqual(L.uncommittedLine(TaskInfoChanges(added: 0, deleted: 0)), "clean")
        XCTAssertEqual(L.uncommittedLine(nil), "unknown")
        XCTAssertEqual(L.baseLine(TaskInfoBase(baseRef: "main", ahead: 2, behind: 0)), "↑2 ahead · ↓0 behind · main")
        XCTAssertEqual(L.baseLine(TaskInfoBase(baseRef: nil, ahead: nil, behind: nil)), "unknown")
        XCTAssertEqual(L.runningLine(nil), "unknown")
        XCTAssertEqual(L.activityLine(nil), "none")
        XCTAssertEqual(L.activityLine(TaskActivity(state: "working", forMs: 247_000)), "working · 4m07s")

        XCTAssertEqual(L.tabState(TaskInfoTab(id: "tab-1", kind: "engine", alive: true)), "running")
        XCTAssertEqual(L.tabState(TaskInfoTab(id: "tab-1", kind: "engine", alive: nil)), "unknown")
        XCTAssertEqual(L.tabState(TaskInfoTab(id: "tab-1", kind: "engine", alive: false,
                                               exit: TabExit(code: 1, signal: nil, cause: "crashed"))), "exited · crashed · code 1")
        XCTAssertEqual(L.tabState(TaskInfoTab(id: "tab-1", kind: "engine", alive: false)), "exited")
        XCTAssertNil(L.tailText(TaskInfoTab(id: "t", kind: "engine", tail: "  \n")))
        XCTAssertEqual(L.tailText(TaskInfoTab(id: "t", kind: "engine", tail: "out\n\n")), "out")

        let pr = try decode(#"{"number":7,"lifecycle":"open","checkState":"failing","reviewDecision":"CHANGES_REQUESTED","mergeable":"CONFLICTING","baseRef":"main"}"#, as: TaskDetailPR.self)
        XCTAssertEqual(L.prLines(pr).map { "\($0.label)=\($0.value)" },
                       ["pr=#7", "lifecycle=open", "checks=failing", "review=changes_requested", "mergeable=conflicting", "base=main"])
        let bare = try decode(#"{"lifecycle":"draft","checkState":"none"}"#, as: TaskDetailPR.self)
        XCTAssertEqual(L.prLines(bare).map { "\($0.label)=\($0.value)" },
                       ["lifecycle=draft", "checks=none", "review=none", "mergeable=unknown"])
    }

    // MARK: decoding

    func testTaskGetDecodesWithAndWithoutOptionalFields() throws {
        let full = try decode(#"""
        {"task":{"id":"t1","title":"Fix","repo":"/r","branch":"b","worktreePath":"/wt","kind":"task","status":"in_review","pinned":true,
         "engine":"codex","command":"codex","model":"gpt","effort":"high","prompt":"p","baseRef":"main","groupId":"g","createdAt":"2026-01-01T00:00:00Z",
         "updatedAt":"2026-01-02T00:00:00Z","pr":{"number":3,"url":"u","lifecycle":"open","checkState":"passing"},"report":{"summary":"done","at":"x"}}}
        """#, as: TaskGetResult.self).task
        XCTAssertEqual(full.engine, "codex"); XCTAssertEqual(full.effort, "high"); XCTAssertEqual(full.pr?.number, 3)
        XCTAssertEqual(full.report?.summary, "done"); XCTAssertEqual(full.pinned, true)

        let bare = try decode(#"{"task":{"id":"t1","title":"","repo":"/r","branch":"b","worktreePath":"","kind":"main","status":"backlog"}}"#, as: TaskGetResult.self).task
        XCTAssertNil(bare.engine); XCTAssertNil(bare.prompt); XCTAssertNil(bare.pr); XCTAssertNil(bare.report); XCTAssertNil(bare.pinned)
        XCTAssertEqual(bare.worktreePath, "")
    }

    func testTaskInfoDecodesWithAndWithoutOptionalFields() throws {
        let full = try decode(#"""
        {"taskId":"t1","running":true,"activity":{"state":"working","forMs":1500},"changes":{"added":4,"deleted":1},
         "base":{"baseRef":"main","ahead":2,"behind":1},
         "tabs":[{"id":"tab-1","kind":"engine","alive":false,"exit":{"code":null,"signal":"SIGKILL","cause":"killed"},"tail":"bye"},
                 {"id":"tab-2","kind":"engine","alive":true}]}
        """#, as: TaskInfoResult.self)
        XCTAssertEqual(full.running, true); XCTAssertEqual(full.changes, TaskInfoChanges(added: 4, deleted: 1))
        XCTAssertEqual(full.base?.behind, 1)
        XCTAssertEqual(full.tabs[0].exit, TabExit(code: nil, signal: "SIGKILL", cause: "killed"))
        XCTAssertEqual(full.tabs[0].tail, "bye"); XCTAssertNil(full.tabs[1].tail); XCTAssertNil(full.tabs[1].exit)

        let nulls = try decode(#"{"taskId":"t1","running":null,"activity":null,"changes":null,"base":null,"tabs":[]}"#, as: TaskInfoResult.self)
        XCTAssertNil(nulls.running); XCTAssertNil(nulls.activity); XCTAssertNil(nulls.changes); XCTAssertNil(nulls.base)
        XCTAssertTrue(nulls.tabs.isEmpty)
        let minimal = try decode(#"{"taskId":"t1","tabs":[{"id":"tab-1","kind":"shell"}]}"#, as: TaskInfoResult.self)
        XCTAssertNil(minimal.running); XCTAssertNil(minimal.tabs[0].alive)
    }

    func testNotesDecodeKeepsDaemonOrderAndTolerantTimestamps() throws {
        let n = try decode(#"""
        {"notes":[{"id":9,"text":"newest","at":"2026-03-01T00:00:00Z","extra":1},{"id":4,"text":"epoch","at":1700000000},{"id":2,"text":"bare"},{"id":1}]}
        """#, as: NotesResult.self).notes
        XCTAssertEqual(n.map(\.id), [9, 4, 2, 1])
        XCTAssertEqual(n[0].at, "2026-03-01T00:00:00Z")
        XCTAssertEqual(n[1].at, "1700000000")
        XCTAssertNil(n[2].at)
        XCTAssertEqual(n[3].text, "")
        XCTAssertTrue(try decode(#"{"notes":[]}"#, as: NotesResult.self).notes.isEmpty)
    }
}
