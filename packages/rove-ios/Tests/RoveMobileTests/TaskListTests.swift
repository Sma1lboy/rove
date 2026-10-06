import XCTest
@testable import RoveMobile

final class TaskListTests: XCTestCase {
    private func row(_ id: String, _ g: TaskGroup = .idle, title: String? = nil, repo: String = "/r/app", branch: String = "",
                     kind: String = "task", rank: Double = 0, pinned: Bool = false, order: Int? = nil,
                     created: String? = nil, updated: String? = nil) -> TaskRow {
        TaskRow(id: id, title: title ?? id, branch: branch, repo: repo, kind: kind, group: g, rank: rank,
                pinned: pinned, order: order, createdAt: created, updatedAt: updated)
    }

    private func ids(_ rows: [TaskRow]) -> [String] { rows.map(\.id) }

    // MARK: Sort modes

    func testAttentionIsTheDefaultAndKeepsGroupOrderWithPinnedFirst() {
        let rows = [row("idle"), row("wait", .waitingOnYou), row("pinIdle", pinned: true), row("work", .working)]
        XCTAssertEqual(ids(TaskListLogic.sorted(rows)), ["pinIdle", "wait", "work", "idle"])
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, mode: .attention)), ids(TaskListLogic.sorted(rows)))
    }

    func testMainThenPinnedThenRestInEveryMode() {
        let rows = [row("a", order: 0), row("p", pinned: true, order: 1), row("m", kind: "main", order: 2), row("b", order: 3)]
        for mode in TaskSortMode.allCases {
            XCTAssertEqual(ids(TaskListLogic.sorted(rows, mode: mode)).prefix(2), ["m", "p"], "\(mode)")
        }
    }

    func testDefaultFollowsDaemonOrderAndRowsWithoutOrderTrailInListOrder() {
        let rows = [row("x"), row("c", order: 2), row("a", order: 0), row("y"), row("b", order: 1)]
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, mode: .default)), ["a", "b", "c", "x", "y"])
    }

    func testDefaultKeepsListOrderWhenNoRowHasOrder() {
        let rows = [row("z"), row("a"), row("m")]
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, mode: .default)), ["z", "a", "m"])
    }

    func testRecentIsNewestFirstWithFractionalSecondsAndCreatedAtFallback() {
        let rows = [row("old", updated: "2026-07-01T00:00:00.000Z"),
                    row("new", updated: "2026-07-03T00:00:00.000Z"),
                    row("created", created: "2026-07-02T00:00:00Z"),
                    row("none")]
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, mode: .recent)), ["new", "created", "old", "none"])
    }

    func testRecentTiesBreakByIdDescendingAndBadTimestampsCountAsZero() {
        let t = "2026-07-01T00:00:00.000Z"
        let rows = [row("a", updated: t), row("b", updated: t), row("junk", updated: "not a date")]
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, mode: .recent)), ["b", "a", "junk"])
        XCTAssertEqual(TaskListLogic.recentTime(row("junk", updated: "not a date")), 0)
    }

    func testNameIsCaseInsensitiveAndNumeric() {
        let rows = [row("1", title: "task 10"), row("2", title: "Task 2"), row("3", title: "alpha"), row("4", title: "  Beta")]
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, mode: .name)), ["3", "4", "2", "1"])
    }

    func testPinnedFloatsWithinEachProjectOnly() {
        let rows = [row("a1", repo: "/a"), row("a2", repo: "/a", pinned: true),
                    row("b1", repo: "/b", pinned: true), row("b2", repo: "/b")]
        for mode in TaskSortMode.allCases {
            let p = TaskListLogic.projects(rows, mode: mode)
            XCTAssertEqual(p.first { $0.repo == "/a" }.map { ids($0.rows) }, ["a2", "a1"], "\(mode)")
            XCTAssertEqual(p.first { $0.repo == "/b" }.map { ids($0.rows) }, ["b1", "b2"], "\(mode)")
        }
    }

    func testProjectOrderFollowsMainsStoredOrderOutsideAttention() {
        let rows = [row("w", .working, repo: "/work", order: 5), row("b-main", repo: "/b", kind: "main", order: 3),
                    row("a-main", repo: "/a", kind: "main", order: 4), row("b1", repo: "/b", order: 0)]
        XCTAssertEqual(TaskListLogic.projects(rows, mode: .default).map(\.repo), ["/b", "/a", "/work"])
        XCTAssertEqual(TaskListLogic.projects(rows, mode: .name).map(\.repo), ["/b", "/a", "/work"])
        // attention: most urgent task first, so the working project leads.
        XCTAssertEqual(TaskListLogic.projects(rows, mode: .attention).first?.repo, "/work")
    }

    // MARK: Fuzzy search

    func testFuzzyIsASubsequenceTestIgnoringCase() {
        XCTAssertNotNil(FuzzyMatch.score("kbe", in: "rove-kube"))
        XCTAssertNotNil(FuzzyMatch.score("CSK", in: "closure-stack-k8s"))
        XCTAssertNil(FuzzyMatch.score("kbe", in: "berserk"))
        XCTAssertNil(FuzzyMatch.score("abc", in: "ab"))
        XCTAssertEqual(FuzzyMatch.score("", in: "anything"), 0)
    }

    func testFuzzyRanksContiguousPrefixAndWordStartsAboveScatter() throws {
        let exact = try XCTUnwrap(FuzzyMatch.score("api", in: "api"))
        let prefix = try XCTUnwrap(FuzzyMatch.score("api", in: "api-gateway"))
        let wordStart = try XCTUnwrap(FuzzyMatch.score("api", in: "my-api"))
        let scattered = try XCTUnwrap(FuzzyMatch.score("api", in: "a big pie"))
        XCTAssertGreaterThan(exact, prefix)
        XCTAssertGreaterThan(prefix, wordStart)
        XCTAssertGreaterThan(wordStart, scattered)
    }

    func testFuzzyFindsALaterBetterAlignment() throws {
        let late = try XCTUnwrap(FuzzyMatch.score("fix", in: "xx f-i-x fix"))
        let scattered = try XCTUnwrap(FuzzyMatch.score("fix", in: "xx f-i-x"))
        XCTAssertGreaterThan(late, scattered)
    }

    func testSearchMatchesTitleBranchAndRepoAndRanksTitleFirst() {
        let rows = [row("branchHit", title: "other", branch: "feat/login"),
                    row("titleHit", title: "login page"),
                    row("repoHit", title: "zzz", repo: "/work/login-app"),
                    row("miss", title: "zzz", branch: "main-x")]
        let out = TaskListLogic.sorted(rows, query: "login")
        XCTAssertEqual(out.first?.id, "titleHit")
        XCTAssertEqual(Set(ids(out)), ["titleHit", "branchHit", "repoHit"])
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, query: "   ")).count, 4)
    }

    func testSearchNeverMatchesAcrossFields() {
        // `tt` is only reachable by joining title "xt" and branch "t": it must not match.
        let r = row("a", title: "xt", branch: "t")
        XCTAssertTrue(TaskListLogic.sorted([r], query: "tt").isEmpty)
    }

    func testSearchFindsATaskByOneOfItsTabTitles() {
        let rows = [row("a", title: "billing", branch: "b1"), row("b", title: "docs", branch: "b2")]
        XCTAssertTrue(TaskListLogic.sorted(rows, query: "flaky").isEmpty)
        let hit = TaskListLogic.sorted(rows, query: "flaky", tabTitles: ["b": ["fix flaky test", "zsh"]])
        XCTAssertEqual(ids(hit), ["b"])
    }

    func testClearingTheQueryRestoresTheModeOrder() {
        let rows = [row("b", .idle), row("a", .waitingOnYou)]
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, query: "")), ["a", "b"])
        XCTAssertEqual(TaskListLogic.projects(rows, query: "zzz").count, 0)
    }

    func testSearchScoreWinsOverPinningAndTiesFallBackToTheMode() {
        let rows = [row("pin", title: "a long login title", pinned: true), row("exact", title: "login")]
        XCTAssertEqual(ids(TaskListLogic.sorted(rows, query: "login")), ["exact", "pin"])
        let tied = [row("p", title: "login", pinned: true), row("q", title: "login")]
        XCTAssertEqual(ids(TaskListLogic.sorted(Array(tied.reversed()), query: "login")), ["p", "q"])
    }

    // MARK: Decoding

    func testOldRowPayloadDecodesWithDefaults() throws {
        let json = #"{"id":"t1","title":"Fix","branch":"fix/x","repo":"/r/app","kind":"task","status":"in-progress","group":"working","rank":1,"deleting":false}"#
        let r = try JSONDecoder().decode(TaskRow.self, from: Data(json.utf8))
        XCTAssertFalse(r.pinned)
        XCTAssertNil(r.order); XCTAssertNil(r.updatedAt); XCTAssertNil(r.createdAt); XCTAssertNil(r.changes)
        XCTAssertTrue(r.rowTokens.isEmpty)
        XCTAssertNil(r.prChip); XCTAssertFalse(r.prChipStale)
    }

    func testNewRowPayloadDecodesEveryAdditiveField() throws {
        let json = #"""
        {"id":"t1","title":"Fix","branch":"fix/x","repo":"/r/app","kind":"task","status":"in-progress","group":"working","rank":1,
         "pinned":true,"order":4,"createdAt":"2026-07-01T00:00:00.000Z","updatedAt":"2026-07-02T00:00:00.000Z",
         "changes":{"added":12,"deleted":3,"ahead":2,"behind":1},
         "rowTokens":[{"text":"build","tone":"success","source":"ci","expiresAt":4102444800000},{"text":"x"}],
         "prChip":"conflict","prChipStale":true,
         "pr":{"number":9,"lifecycle":"open","checkState":"passing","mergeable":"CONFLICTING"}}
        """#
        let r = try JSONDecoder().decode(TaskRow.self, from: Data(json.utf8))
        XCTAssertTrue(r.pinned); XCTAssertEqual(r.order, 4)
        XCTAssertEqual(r.updatedAt, "2026-07-02T00:00:00.000Z")
        XCTAssertEqual(r.changes, TaskChanges(added: 12, deleted: 3, ahead: 2, behind: 1, unreadable: nil))
        XCTAssertEqual(r.rowTokens.count, 2); XCTAssertEqual(r.rowTokens[0].tone, "success"); XCTAssertNil(r.rowTokens[1].tone)
        XCTAssertEqual(r.prChip, "conflict"); XCTAssertTrue(r.prChipStale)
        XCTAssertEqual(r.pr?.mergeable, "CONFLICTING")
        let u = try JSONDecoder().decode(TaskRow.self, from: Data(#"{"id":"u","changes":{"unreadable":true}}"#.utf8))
        XCTAssertEqual(u.changes?.isUnreadable, true)
    }

    func testEngineReadyDecodesWithAndWithout() throws {
        let old = #"{"id":"c","name":"Claude","command":"claude","protocol":"acp","builtin":true}"#
        let new = #"{"id":"x","name":"Codex","command":"codex","protocol":"acp","builtin":true,"ready":false}"#
        XCTAssertNil(try JSONDecoder().decode(Engine.self, from: Data(old.utf8)).ready)
        XCTAssertEqual(try JSONDecoder().decode(Engine.self, from: Data(new.utf8)).ready, false)
    }

    // MARK: Marks

    func testChangesMarkFormatting() {
        let m = TaskRowMarks.changes(TaskChanges(added: 12, deleted: 3, ahead: nil, behind: nil, unreadable: nil))
        XCTAssertEqual(m.map(\.text).joined(), "+12/−3")
        XCTAssertEqual(m.map(\.tone), [.success, .muted, .error])
        XCTAssertEqual(TaskRowMarks.changes(TaskChanges(added: 0, deleted: 4)).map(\.text).joined(), "+0/−4")
        XCTAssertTrue(TaskRowMarks.changes(nil).isEmpty)
        XCTAssertTrue(TaskRowMarks.changes(TaskChanges(added: 0, deleted: 0)).isEmpty)
        XCTAssertEqual(TaskRowMarks.changes(TaskChanges(unreadable: true)), [MarkSegment(text: "?", tone: .muted)])
    }

    func testAheadBehindShowsOnlyNonZeroSides() {
        func marks(_ a: Int?, _ b: Int?) -> [MarkSegment] { TaskRowMarks.aheadBehind(TaskChanges(ahead: a, behind: b)) }
        XCTAssertEqual(marks(2, 1).map(\.text).joined(), "↑2/↓1")
        XCTAssertEqual(marks(2, 1).map(\.tone), [.muted, .muted, .accent])
        XCTAssertEqual(marks(3, 0), [MarkSegment(text: "↑3", tone: .muted)])
        XCTAssertEqual(marks(nil, 4), [MarkSegment(text: "↓4", tone: .accent)])
        XCTAssertTrue(marks(0, 0).isEmpty)
        XCTAssertTrue(TaskRowMarks.aheadBehind(nil).isEmpty)
        XCTAssertTrue(TaskRowMarks.aheadBehind(TaskChanges(ahead: 2, unreadable: true)).isEmpty)
    }

    func testPRMarkGlyphsTonesAndStale() {
        XCTAssertEqual(TaskRowMarks.prMark(kind: "conflict", stale: false), MarkSegment(text: "≠", tone: .error))
        XCTAssertEqual(TaskRowMarks.prMark(kind: "failing", stale: false), MarkSegment(text: "✗", tone: .error))
        XCTAssertEqual(TaskRowMarks.prMark(kind: "passing", stale: false), MarkSegment(text: "✓", tone: .success))
        XCTAssertEqual(TaskRowMarks.prMark(kind: "passing", stale: true)?.tone, .muted)
        XCTAssertNil(TaskRowMarks.prMark(kind: nil, stale: false))
        XCTAssertNil(TaskRowMarks.prMark(kind: "pending", stale: false))
        XCTAssertEqual(TaskRowMarks.prNumber(TaskPR(number: 12, url: nil, lifecycle: "open", checkState: "passing")), "#12")
        XCTAssertNil(TaskRowMarks.prNumber(nil))
    }

    func testChipKindPrefersBridgeThenDerivesFromPROnOlderBridges() {
        func pr(_ check: String, _ mergeable: String? = nil) -> TaskPR {
            TaskPR(number: 1, url: nil, lifecycle: "open", checkState: check, mergeable: mergeable)
        }
        var r = row("a")
        r.pr = pr("passing", "conflicting")
        XCTAssertEqual(TaskRowMarks.chipKind(r), "conflict")
        r.pr = pr("failing"); XCTAssertEqual(TaskRowMarks.chipKind(r), "failing")
        r.pr = pr("passing"); XCTAssertEqual(TaskRowMarks.chipKind(r), "passing")
        r.pr = pr("pending"); XCTAssertNil(TaskRowMarks.chipKind(r))
        r.prChip = "failing"; r.pr = pr("passing")
        XCTAssertEqual(TaskRowMarks.chipKind(r), "failing")
    }

    func testTokenLivenessAndTones() {
        let now = Date(timeIntervalSince1970: 1_000)
        let live = RowTokenChip(text: "a", tone: "success", source: "s", expiresAt: 1_000_001)
        let dead = RowTokenChip(text: "b", tone: nil, source: "s", expiresAt: 1_000_000)
        let forever = RowTokenChip(text: "c", tone: nil, source: nil, expiresAt: nil)
        let blank = RowTokenChip(text: "", tone: nil, source: nil, expiresAt: nil)
        XCTAssertEqual(TaskRowMarks.liveTokens([live, dead, forever, blank], now: now).map(\.text), ["a", "c"])
        XCTAssertEqual(TaskRowMarks.liveTokens([live], now: now.addingTimeInterval(5)), [])
        XCTAssertEqual(TaskRowMarks.tokenTone("success"), .success)
        XCTAssertEqual(TaskRowMarks.tokenTone("error"), .error)
        XCTAssertEqual(TaskRowMarks.tokenTone("warning"), .ink)
        XCTAssertEqual(TaskRowMarks.tokenTone("info"), .ink)
        XCTAssertEqual(TaskRowMarks.tokenTone(nil), .muted)
        XCTAssertEqual(TaskRowMarks.tokenTone("weird"), .muted)
    }

    // MARK: Welcome / empty states

    func testEmptinessPredicate() {
        XCTAssertEqual(TaskListLogic.emptiness(loaded: false, total: 0, shown: 0), .none)
        XCTAssertEqual(TaskListLogic.emptiness(loaded: true, total: 0, shown: 0), .welcome)
        XCTAssertEqual(TaskListLogic.emptiness(loaded: true, total: 3, shown: 0), .noMatches)
        XCTAssertEqual(TaskListLogic.emptiness(loaded: true, total: 3, shown: 2), .none)
    }

    func testWelcomeEngineLines() throws {
        let json = #"[{"id":"c","name":"Claude","command":"c","protocol":"acp","builtin":true},{"id":"x","name":"Codex","command":"x","protocol":"acp","builtin":true,"ready":true},{"id":"g","name":"Gemini","command":"g","protocol":"acp","builtin":false,"ready":false}]"#
        let engines = try JSONDecoder().decode([Engine].self, from: Data(json.utf8))
        XCTAssertEqual(TaskWelcomeView.engineLine(engines), "[ claude ] [ codex ]")
        XCTAssertEqual(TaskWelcomeView.notReadyLines(engines), ["[ gemini ] not signed in"])
    }
}
