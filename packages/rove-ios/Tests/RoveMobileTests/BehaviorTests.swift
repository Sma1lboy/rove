import XCTest
@testable import RoveMobile

final class BehaviorTests: XCTestCase {
    private func row(_ id: String, _ g: TaskGroup, rank: Double = 0, repo: String = "/r") -> TaskRow {
        TaskRow(id: id, title: id, repo: repo, group: g, rank: rank)
    }

    // MARK: Notification transitions

    func testEnteringWaitingNotifies() {
        let n = TransitionRule.notice(old: row("a", .working), new: row("a", .waitingOnYou))
        XCTAssertEqual(n?.kind, .waitingOnYou)
        XCTAssertEqual(TransitionRule.notice(old: row("a", .idle), new: row("a", .waitingOnYou))?.kind, .waitingOnYou)
    }

    func testStayingWaitingDoesNotNotify() {
        XCTAssertNil(TransitionRule.notice(old: row("a", .waitingOnYou), new: row("a", .waitingOnYou)))
    }

    func testWorkingToReadyOrIdleNotifies() {
        XCTAssertEqual(TransitionRule.notice(old: row("a", .working), new: row("a", .readyForReview))?.kind, .finished)
        XCTAssertEqual(TransitionRule.notice(old: row("a", .working), new: row("a", .idle))?.kind, .finished)
    }

    func testOtherTransitionsDoNotNotify() {
        XCTAssertNil(TransitionRule.notice(old: row("a", .idle), new: row("a", .readyForReview)))
        XCTAssertNil(TransitionRule.notice(old: row("a", .working), new: row("a", .landing)))
        XCTAssertNil(TransitionRule.notice(old: row("a", .readyForReview), new: row("a", .working)))
    }

    func testFirstSnapshotAndNewRowsAreSilent() {
        XCTAssertTrue(TransitionRule.notices(old: nil, new: [row("a", .waitingOnYou)]).isEmpty)
        XCTAssertTrue(TransitionRule.notices(old: [], new: [row("a", .waitingOnYou)]).isEmpty)
        let ns = TransitionRule.notices(old: [row("a", .working), row("b", .working)],
                                        new: [row("a", .waitingOnYou), row("b", .working), row("c", .waitingOnYou)])
        XCTAssertEqual(ns.map(\.taskId), ["a"])
    }

    // MARK: Sorting / attention

    func testGroupSortWaitingFirstThenRankThenStable() {
        let rows = [row("w1", .working, rank: 1), row("i", .idle), row("wait", .waitingOnYou, rank: 9),
                    row("w0", .working, rank: 0), row("w1b", .working, rank: 1), row("u", .unknown), row("l", .landing)]
        XCTAssertEqual(TaskListLogic.sorted(rows).map(\.id), ["wait", "l", "w0", "w1", "w1b", "i", "u"])
    }

    func testProjectsOrderedByMostUrgentTaskRowsKeepGroupOrder() {
        let rows = [row("x-idle", .idle, repo: "/x"), row("y-work", .working, repo: "/y"),
                    row("x-wait", .waitingOnYou, repo: "/x"), row("y-ready", .readyForReview, repo: "/y"),
                    row("z-idle", .idle, repo: "/z")]
        let projects = TaskListLogic.projects(rows)
        XCTAssertEqual(projects.map(\.repo), ["/x", "/y", "/z"])
        XCTAssertEqual(projects[0].rows.map(\.id), ["x-wait", "x-idle"])
        XCTAssertEqual(projects[1].rows.map(\.id), ["y-ready", "y-work"])
    }

    func testAttentionCountOnlyUnread() {
        let items = [AttentionItem(taskId: "a", tabId: nil, state: "s", unread: true, at: 1),
                     AttentionItem(taskId: "b", tabId: nil, state: "s", unread: false, at: 2),
                     AttentionItem(taskId: nil, tabId: nil, state: "s", unread: true, at: 3)]
        XCTAssertEqual(TaskListLogic.attentionCount(items), 2)
    }

    func testRepoFilterAndRepos() {
        let rows = [row("a", .idle, repo: "/x"), row("b", .idle, repo: "/y"), row("c", .idle, repo: "/x")]
        XCTAssertEqual(TaskListLogic.repos(rows), ["/x", "/y"])
        XCTAssertEqual(TaskListLogic.filtered(rows, repo: "/x").map(\.id), ["a", "c"])
        XCTAssertEqual(TaskListLogic.filtered(rows, repo: nil).count, 3)
    }

    func testLocalAging() {
        let t0 = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(TaskListLogic.ageMs(forMs: 60_000, receivedAt: t0, now: t0.addingTimeInterval(120)), 180_000)
        XCTAssertEqual(TaskListLogic.ageMs(forMs: 5_000, receivedAt: t0, now: t0.addingTimeInterval(-3)), 5_000)
    }

    /// `activity.since` is an optional, additive bridge field the app never reads: with it or
    /// without it (an older bridge), the timer is `forMs` at receipt plus local elapsed time.
    @MainActor
    func testTimerAgesFromForMsWhetherOrNotTheBridgeSendsSince() throws {
        for activity in [#"{"state":"running","forMs":60000}"#,
                         #"{"state":"running","forMs":60000,"since":1700000000000}"#] {
            let json = #"{"tasks":[{"id":"t1","title":"t","group":"working","activity":"# + activity + "}]}"
            let payload = try JSONDecoder().decode(TasksPayload.self, from: Data(json.utf8))
            let store = TaskStore(client: BridgeClient())
            store.apply(payload)
            let row = try XCTUnwrap(store.task(id: "t1"))
            let ms = try XCTUnwrap(store.activityMs(row, now: Date().addingTimeInterval(30)))
            XCTAssertEqual(ms, 90_000, accuracy: 1_000, activity)
        }
    }

    func testAgeFormatting() {
        XCTAssertEqual(TaskListLogic.age(ms: 5_000), "5s")
        XCTAssertEqual(TaskListLogic.age(ms: 125_000), "2m")
        XCTAssertEqual(TaskListLogic.age(ms: 7_200_000), "2h")
        XCTAssertEqual(TaskListLogic.age(ms: 200_000_000), "2d")
    }

    func testClockShowsSecondsUnderAnHour() {
        XCTAssertEqual(TaskListLogic.clock(ms: 9_400), "9s")
        XCTAssertEqual(TaskListLogic.clock(ms: 247_000), "4m07s")
        XCTAssertEqual(TaskListLogic.clock(ms: 3_599_000), "59m59s")
        XCTAssertEqual(TaskListLogic.clock(ms: 7_380_000), "2h03m")
        XCTAssertEqual(TaskListLogic.clock(ms: 200_000_000), "2d")
        XCTAssertEqual(TaskListLogic.clock(ms: -5), "0s")
    }

    // MARK: Accessory keys

    func testAccessoryKeyBytes() {
        XCTAssertEqual(KeyMapper.sequence(for: .esc), "\u{1b}")
        XCTAssertEqual(KeyMapper.sequence(for: .tab), "\t")
        XCTAssertEqual(KeyMapper.sequence(for: .shiftTab), "\u{1b}[Z")
        XCTAssertEqual(KeyMapper.sequence(for: .enter), "\r")
        XCTAssertEqual(KeyMapper.sequence(for: .ctrlC), "\u{03}")
        XCTAssertEqual([AccessoryKey.up, .down, .right, .left].map { KeyMapper.sequence(for: $0) },
                       ["\u{1b}[A", "\u{1b}[B", "\u{1b}[C", "\u{1b}[D"])
        XCTAssertNil(KeyMapper.sequence(for: .ctrl))
    }

    func testStickyCtrl() {
        var m = KeyMapper()
        XCTAssertNil(m.press(.ctrl))
        XCTAssertTrue(m.ctrlArmed)
        XCTAssertEqual(m.transformTyped("d"), "\u{04}")
        XCTAssertFalse(m.ctrlArmed)
        XCTAssertEqual(m.transformTyped("d"), "d")
        _ = m.press(.ctrl); XCTAssertEqual(m.transformTyped("C"), "\u{03}")
        _ = m.press(.ctrl); _ = m.press(.ctrl)
        XCTAssertFalse(m.ctrlArmed, "second tap disarms")
        _ = m.press(.ctrl)
        XCTAssertEqual(m.press(.up), "\u{1b}[A")
        XCTAssertFalse(m.ctrlArmed, "any key consumes Ctrl")
        _ = m.press(.ctrl)
        XCTAssertEqual(m.transformTyped("hello"), "hello")
        XCTAssertFalse(m.ctrlArmed)
    }

    // MARK: Query reply filter

    private func filtered(_ s: String) -> String {
        String(decoding: QueryReplyFilter.filter(Array(s.utf8)), as: UTF8.self)
    }

    func testDropsTerminalQueryReplies() {
        XCTAssertEqual(filtered("\u{1b}[?62;22c"), "")
        XCTAssertEqual(filtered("\u{1b}[>0;276;0c"), "")
        XCTAssertEqual(filtered("\u{1b}[?2026;2$y"), "")
        XCTAssertEqual(filtered("\u{1b}[4;1$y"), "")
        XCTAssertEqual(filtered("\u{1b}]10;rgb:ffff/ffff/ffff\u{07}"), "")
        XCTAssertEqual(filtered("\u{1b}]11;rgb:0000/0000/0000\u{1b}\\"), "")
        XCTAssertEqual(filtered("\u{1b}]4;1;rgb:cdcd/0000/0000\u{07}"), "")
    }

    func testPassesEverythingElse() {
        XCTAssertEqual(filtered("\u{1b}[12;40R"), "\u{1b}[12;40R", "cursor position report passes")
        XCTAssertEqual(filtered("ls -la\r"), "ls -la\r")
        XCTAssertEqual(filtered("\u{1b}[A"), "\u{1b}[A")
        XCTAssertEqual(filtered("héllo"), "héllo")
        XCTAssertEqual(filtered("\u{1b}]52;c;aGk=\u{07}"), "\u{1b}]52;c;aGk=\u{07}")
    }

    func testStripsRepliesButKeepsAdjacentInput() {
        XCTAssertEqual(filtered("\u{1b}[?62;22cx\u{1b}[12;40R"), "x\u{1b}[12;40R")
    }
}
