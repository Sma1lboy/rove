import XCTest
@testable import RoveMobile

/// Additive-protocol compat: a newer bridge adds optional fields and push events, an older one lacks
/// them. Both must decode here.
final class TerminalCompatTests: XCTestCase {
    private func attention(_ json: String) throws -> TasksPayload {
        try JSONDecoder().decode(TasksPayload.self, from: Data(#"{"tasks":[],"attention":[\#(json)]}"#.utf8))
    }

    func testAttentionRowWithAndWithoutResumeAndLabel() throws {
        let old = try attention(#"{"taskId":"t","tabId":"tab-1","state":"rate_limited","unread":true,"at":5}"#).attention[0]
        XCTAssertNil(old.resumeAt)
        XCTAssertNil(old.label)
        let new = try attention(#"{"taskId":null,"tabId":null,"state":"routine_failed","unread":true,"at":6,"resumeAt":"2026-10-05T15:14:00.000Z","label":"nightly"}"#).attention[0]
        XCTAssertEqual(new.resumeAt, "2026-10-05T15:14:00.000Z")
        XCTAssertEqual(new.label, "nightly")
    }

    func testNoticeEventDecodesAndOldFieldsAreOptional() {
        let full = #"{"event":"notice","data":{"title":"deploy done","body":"staging","kind":"needs_input","taskId":"t1","source":"ci","at":1700000000000}}"#
        guard case .event(let name, let data)? = IncomingFrame.parse(Data(full.utf8)),
              case .notice(let n)? = BridgeEvent.from(name: name, data: data) else { return XCTFail("notice not decoded") }
        XCTAssertEqual(n, Notice(title: "deploy done", body: "staging", kind: "needs_input", taskId: "t1", source: "ci", at: 1700000000000))
        let bare = Data(#"{"title":"hi","at":3}"#.utf8)
        guard case .notice(let b)? = BridgeEvent.from(name: "notice", data: bare) else { return XCTFail() }
        XCTAssertEqual(b.kind, "done")
        XCTAssertNil(b.body)
    }

    func testEventsThisBuildDoesNotKnowAreDropped() {
        XCTAssertNil(BridgeEvent.from(name: "notice.v2", data: Data(#"{"title":"x"}"#.utf8)))
        XCTAssertNil(BridgeEvent.from(name: "notice", data: Data(#"{"nope":1}"#.utf8)), "a notice without a title is not a toast")
    }

    func testTabStatesDecodeWithoutTheField() throws {
        let some = try JSONDecoder().decode(TabStatesResult.self, from: Data(#"{"tabs":{"tab-1":{"state":"running","at":9}}}"#.utf8))
        XCTAssertEqual(some.tabs["tab-1"], TabActivity(state: "running", at: 9))
        XCTAssertTrue(try JSONDecoder().decode(TabStatesResult.self, from: Data("{}".utf8)).tabs.isEmpty)
    }

    func testForkAndHandoffAnswers() throws {
        XCTAssertEqual(try JSONDecoder().decode(ForkTaskResult.self, from: Data(#"{"taskIds":["a","b"]}"#.utf8)).taskIds, ["a", "b"])
        let refusal = try JSONDecoder().decode(HandoffAnswer.self, from: Data(#"{"kind":"no-transcript","engine":"Kimi"}"#.utf8))
        XCTAssertNil(refusal.prompt)
        XCTAssertEqual(NewSessionLogic.refusal(refusal), "Kimi keeps no transcript rove can read, so there is nothing to hand off")
    }
}

final class TerminalInputTests: XCTestCase {
    func testMultiLineMessageIsOneBracketedPaste() {
        XCTAssertEqual(PasteEncoding.message("one line"), "one line")
        XCTAssertEqual(PasteEncoding.message("a\nb"), "\u{1B}[200~a\nb\u{1B}[201~")
        XCTAssertEqual(PasteEncoding.message("a\r\nb"), "\u{1B}[200~a\nb\u{1B}[201~", "CRLF must not submit early")
    }

    func testPastedTextCannotCloseThePasteOrDriveKeys() {
        let evil = "x\u{1B}[201~\u{1B}[A\u{03}rm -rf\ty"
        let out = PasteEncoding.paste(evil)
        XCTAssertEqual(out, "\u{1B}[200~x[201~[Arm -rf\ty\u{1B}[201~")
        XCTAssertEqual(out.components(separatedBy: "\u{1B}").count - 1, 2, "only the framing escapes remain")
    }

    func testAttachmentRefsMatchTheTuiFormat() {
        XCTAssertEqual(AttachmentLogic.ref(path: "/h/.rove/attachments/a.png", index: 0), "images[0]: /h/.rove/attachments/a.png")
        XCTAssertEqual(AttachmentLogic.ref(path: "/h/b.PDF", index: 1), "pdf[1]: /h/b.PDF")
    }

    func testPrepareSniffsByBytesNotName() throws {
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0])
        XCTAssertEqual(try AttachmentLogic.prepare(png).mime, "image/png")
        XCTAssertEqual(try AttachmentLogic.prepare(Data("%PDF-1.7".utf8)).mime, "application/pdf")
        XCTAssertThrowsError(try AttachmentLogic.prepare(Data("plain text".utf8))) {
            XCTAssertEqual($0 as? AttachmentLogic.PrepareError, .unsupported)
        }
        let bigPDF = Data("%PDF".utf8) + Data(count: AttachmentLogic.maxBytes)
        XCTAssertThrowsError(try AttachmentLogic.prepare(bigPDF)) { XCTAssertEqual($0 as? AttachmentLogic.PrepareError, .tooLarge) }
    }
}

final class TabStateTests: XCTestCase {
    private func a(_ state: String, _ at: Double = 10) -> TabActivity { TabActivity(state: state, at: at) }

    func testGlyphVocabulary() {
        XCTAssertEqual(TabStateLogic.glyph(activity: a("running"), alive: true, seenAt: nil), .working)
        XCTAssertEqual(TabStateLogic.glyph(activity: a("permission_needed"), alive: true, seenAt: nil), .needsInput)
        XCTAssertEqual(TabStateLogic.glyph(activity: a("error"), alive: true, seenAt: nil), .error)
        XCTAssertEqual(TabStateLogic.glyph(activity: a("rate_limited"), alive: true, seenAt: nil), .rateLimited)
        XCTAssertEqual(TabStateLogic.glyph(activity: a("dead"), alive: true, seenAt: nil), .exited)
        XCTAssertEqual(TabStateLogic.glyph(activity: a("running"), alive: false, seenAt: nil), .exited, "a gone session beats a stale reading")
        XCTAssertEqual(TabStateLogic.glyph(activity: nil, alive: true, seenAt: nil), .quiet)
        XCTAssertEqual(TabStateLogic.glyph(activity: a("idle"), alive: nil, seenAt: nil), .quiet)
    }

    func testSeenMeansConsumed() {
        XCTAssertEqual(TabStateLogic.glyph(activity: a("turn_complete", 10), alive: true, seenAt: nil), .unseenDone)
        XCTAssertEqual(TabStateLogic.glyph(activity: a("turn_complete", 10), alive: true, seenAt: 10), .quiet)
        XCTAssertEqual(TabStateLogic.glyph(activity: a("turn_complete", 11), alive: true, seenAt: 10), .unseenDone, "a later completion is unread again")
    }

    func testSeenMarksPersistAndNeverMoveBackwards() {
        let suite = "seen-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let marks = SeenMarks(defaults: defaults)
        marks.mark(task: "t", tab: "tab-1", at: 20)
        marks.mark(task: "t", tab: "tab-1", at: 5)
        XCTAssertEqual(SeenMarks(defaults: defaults).seenAt(task: "t", tab: "tab-1"), 20)
        XCTAssertNil(marks.seenAt(task: "t", tab: "tab-2"))
    }
}

final class NewSessionLogicTests: XCTestCase {
    private let handoff = HandoffAnswer(kind: "handoff", prompt: "BRIEF", engine: nil)

    private func request(_ d: SessionDestination, _ c: SessionContext, message: String = "do it", handoff: HandoffAnswer? = nil,
                         attempts: Int = 1, branch: String = "feat/x") -> NewSessionLogic.Request? {
        NewSessionLogic.request(destination: d, context: c, engine: "claude", message: message, handoff: handoff,
                                attempts: attempts, repo: "/r", branch: branch)
    }

    func testFreshNeedsWordsContinueNeedsTheBrief() {
        XCTAssertEqual(request(.tab, .fresh), .tab(prompt: "do it", engine: "claude"))
        XCTAssertNil(request(.tab, .fresh, message: "  "))
        XCTAssertNil(request(.tab, .continued, handoff: nil))
        XCTAssertNil(request(.tab, .continued, handoff: HandoffAnswer(kind: "no-session", prompt: nil, engine: nil)))
        XCTAssertEqual(request(.tab, .continued, message: "", handoff: handoff), .tab(prompt: "BRIEF", engine: "claude"))
        XCTAssertEqual(request(.tab, .continued, handoff: handoff), .tab(prompt: "BRIEF\n\ndo it", engine: "claude"))
    }

    func testForkBranchesFromTheTaskAndCapsAttempts() {
        XCTAssertEqual(request(.fork, .fresh, attempts: 3), .fork(repo: "/r", baseBranch: "feat/x", prompt: "do it", engine: "claude", count: 3))
        XCTAssertEqual(request(.fork, .fresh, attempts: 99), .fork(repo: "/r", baseBranch: "feat/x", prompt: "do it", engine: "claude", count: 5))
        XCTAssertNil(request(.fork, .fresh, branch: ""), "a main checkout has no branch of its own to fork from")
    }
}

final class InboxLogicTests: XCTestCase {
    private func item(_ task: String, _ tab: String?, _ state: String, at: Double) -> AttentionItem {
        AttentionItem(taskId: task, tabId: tab, state: state, unread: true, at: at)
    }

    func testBlockedFirstThenOldestFirst() {
        let items = [item("a", "tab-1", "turn_complete", at: 1), item("b", "tab-1", "permission_needed", at: 9),
                     item("c", "tab-1", "rate_limited", at: 5), item("d", "tab-1", "turn_complete", at: 2)]
        XCTAssertEqual(InboxLogic.sorted(items, taskOrder: []).map(\.taskId), ["c", "b", "a", "d"])
    }

    func testSameInstantFallsBackToTaskOrder() {
        let items = [item("b", nil, "error", at: 3), item("a", nil, "error", at: 3)]
        XCTAssertEqual(InboxLogic.sorted(items, taskOrder: ["b", "a"]).map(\.taskId), ["b", "a"])
        XCTAssertEqual(InboxLogic.sorted(items, taskOrder: ["a", "b"]).map(\.taskId), ["a", "b"])
    }

    func testNextPendingWalksAndWraps() {
        let sorted = InboxLogic.sorted([item("a", "tab-1", "error", at: 1), item("b", "tab-1", "turn_complete", at: 2)], taskOrder: [])
        let first = InboxLogic.next(after: nil, in: sorted)
        XCTAssertEqual(first?.taskId, "a")
        let second = InboxLogic.next(after: first.map(InboxLogic.key), in: sorted)
        XCTAssertEqual(second?.taskId, "b")
        XCTAssertEqual(InboxLogic.next(after: second.map(InboxLogic.key), in: sorted)?.taskId, "a")
        XCTAssertEqual(InboxLogic.next(after: "gone", in: sorted)?.taskId, "a", "a cleared item restarts at the head")
        XCTAssertNil(InboxLogic.next(after: nil, in: []))
    }

    func testRoutineItemsAreNotOpenableByF7() {
        let routine = AttentionItem(taskId: nil, tabId: nil, state: "routine_failed", unread: true, at: 1, label: "nightly")
        XCTAssertNil(InboxLogic.next(after: nil, in: [routine]))
    }

    func testRecentIsNewestFirstDedupedAndSkipsPendingAndDeletedTasks() {
        let visits = [Visit(taskId: "a", tabId: "tab-1", at: 1), Visit(taskId: "b", tabId: "tab-1", at: 5),
                      Visit(taskId: "a", tabId: "tab-1", at: 9), Visit(taskId: "c", tabId: "tab-2", at: 7),
                      Visit(taskId: "gone", tabId: "tab-1", at: 8), Visit(taskId: "d", tabId: nil, at: 6)]
        let pending = [item("c", nil, "turn_complete", at: 1)]
        let out = InboxLogic.recent(visits: visits, attention: pending, taskIds: ["a", "b", "c", "d"])
        XCTAssertEqual(out.map(\.taskId), ["a", "d", "b"], "c is covered by a task-level episode; gone no longer exists")
        XCTAssertEqual(InboxLogic.recent(visits: visits, attention: [], taskIds: ["a", "b", "c", "d"], limit: 2).count, 2)
    }

    func testVisitLogKeepsOneRowPerTargetAndCaps() {
        var log: [Visit] = []
        for i in 0..<40 { log = InboxLogic.appending(Visit(taskId: "t\(i)", tabId: "tab-1", at: Double(i)), to: log) }
        XCTAssertEqual(log.count, 30)
        log = InboxLogic.appending(Visit(taskId: "t39", tabId: "tab-1", at: 99), to: log)
        XCTAssertEqual(log.filter { $0.taskId == "t39" }.count, 1)
        XCTAssertEqual(log.first?.at, 99)
    }

    func testResumeLabel() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let us = Locale(identifier: "en_US")
        let now = ISO8601DateFormatter().date(from: "2026-10-05T10:00:00Z")!
        XCTAssertEqual(InboxLogic.resumeLabel(iso: "2026-10-05T15:14:00.000Z", now: now, calendar: cal, locale: us), "resumes 3:14 PM")
        XCTAssertTrue(InboxLogic.resumeLabel(iso: "2026-10-06T01:00:00Z", now: now, calendar: cal, locale: us)?.contains("Oct 6") == true)
        XCTAssertNil(InboxLogic.resumeLabel(iso: nil))
        XCTAssertNil(InboxLogic.resumeLabel(iso: "soon"))
    }

    @MainActor func testVisitLogPersistsAcrossLaunches() {
        let suite = "inbox-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        InboxState(defaults: defaults).record(taskId: "t", tabId: "tab-2", now: Date(timeIntervalSince1970: 100))
        XCTAssertEqual(InboxState(defaults: defaults).visits, [Visit(taskId: "t", tabId: "tab-2", at: 100_000)])
    }
}
