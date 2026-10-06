import XCTest
@testable import RoveMobile

/// Decoding of the Board / Routines / GitHub issues payloads, WITH and WITHOUT every optional
/// field (an older or newer bridge must never fail a whole list), and the pure logic the pages use.
final class PagesTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String, as: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: Issue store

    func testStoryWithAndWithoutLink() throws {
        let linked = try decode(#"{"id":4,"title":"Ship","status":"doing","created":"2026-10-05","body":"b","taskId":"T1"}"#, as: Story.self)
        XCTAssertEqual(linked.taskId, "T1")
        XCTAssertTrue(linked.linked)
        let bare = try decode(#"{"id":5,"title":"Bare","status":"open","created":"2026-10-05","body":""}"#, as: Story.self)
        XCTAssertNil(bare.taskId)
        // An empty link is no link; an unknown status reads as open instead of failing the list.
        let odd = try decode(#"{"id":6,"status":"shipped","taskId":""}"#, as: Story.self)
        XCTAssertNil(odd.taskId)
        XCTAssertEqual(odd.status, .open)
        XCTAssertEqual(odd.title, "")
    }

    func testRepoIssuesWithAndWithoutSkipped() throws {
        let full = try decode(#"{"repoRoot":"/r","exists":true,"nextId":3,"issues":[{"id":1,"title":"a"}],"skipped":2}"#, as: RepoIssues.self)
        XCTAssertEqual(full.skipped, 2)
        XCTAssertEqual(full.issues.map(\.id), [1])
        let minimal = try decode(#"{"repoRoot":"/r"}"#, as: RepoIssues.self)
        XCTAssertEqual(minimal.skipped, 0)
        XCTAssertTrue(minimal.issues.isEmpty)
    }

    func testClearedDescriptionReadsEmpty() {
        XCTAssertEqual(Story(id: 1, title: "t", body: " ").detail, "")
        XCTAssertEqual(Story(id: 1, title: "t", body: "\n line \n").detail, "line")
    }

    // MARK: Board columns

    private func story(_ id: Int, _ status: IssueStatus, task: String? = nil, created: String = "2026-10-01") -> Story {
        Story(id: id, title: "s\(id)", status: status, created: created, taskId: task)
    }

    func testColumnRules() {
        let alive: (String) -> Bool = { $0 == "live" }
        XCTAssertEqual(BoardLogic.column(for: story(1, .open), taskExists: alive), .backlog)
        XCTAssertEqual(BoardLogic.column(for: story(2, .open, task: "live"), taskExists: alive), .inProgress)
        // A link to a task that is gone reads as unlinked: back to the backlog, startable.
        XCTAssertEqual(BoardLogic.column(for: story(3, .open, task: "gone"), taskExists: alive), .backlog)
        // ...but an unlinked `doing` still moves the card, and a dangling doing stays in progress.
        XCTAssertEqual(BoardLogic.column(for: story(4, .doing), taskExists: alive), .inProgress)
        XCTAssertEqual(BoardLogic.column(for: story(5, .doing, task: "gone"), taskExists: alive), .inProgress)
        // Parked and done outrank a link: a parked story must not render as active work.
        XCTAssertEqual(BoardLogic.column(for: story(6, .hold, task: "live"), taskExists: alive), .parked)
        XCTAssertEqual(BoardLogic.column(for: story(7, .done, task: "live"), taskExists: alive), .done)
        // Before the task feed arrives the link alone decides.
        XCTAssertEqual(BoardLogic.column(for: story(8, .open, task: "gone"), taskExists: nil), .inProgress)
    }

    func testColumnsSortNewestFirstAndCapTheAccretingOnes() {
        let many = (1...25).map { story($0, .done, created: "2026-10-\(String(format: "%02d", $0))") }
        let cols = BoardLogic.columns(many + [story(100, .open, created: "2026-09-01"), story(101, .open, created: "2026-09-01")],
                                      taskExists: nil)
        XCTAssertEqual(cols.map(\.key), [.backlog, .inProgress, .parked, .done])
        // Same day: the higher id first.
        XCTAssertEqual(cols[0].stories.map(\.id), [101, 100])
        XCTAssertEqual(cols[3].stories.count, BoardLogic.cap)
        XCTAssertEqual(cols[3].hiddenCount, 5)
        XCTAssertEqual(cols[3].stories.first?.id, 25)
        XCTAssertEqual(cols[0].hiddenCount, 0)
    }

    func testAttentionFloatsInProgressButNeverParked() {
        let stories = [story(1, .doing, task: "calm"), story(2, .doing, task: "hot"), story(3, .hold, task: "hot")]
        let cols = BoardLogic.columns(stories, taskExists: nil)
        let (floated, count) = BoardLogic.floatingAttention(cols) { $0 == "hot" }
        XCTAssertEqual(count, 1)
        XCTAssertEqual(floated[1].stories.map(\.id), [2, 1])
        XCTAssertEqual(floated[2].stories.map(\.id), [3])
        let (same, none) = BoardLogic.floatingAttention(cols) { _ in false }
        XCTAssertEqual(none, 0)
        XCTAssertEqual(same, cols)
    }

    func testProjectsDedupeThePrivateTmpAlias() {
        XCTAssertEqual(BoardLogic.repoKey("/private/tmp/x/app"), "/tmp/x/app")
        XCTAssertEqual(BoardLogic.repoKey("/private/var/folders/a"), "/var/folders/a")
        XCTAssertEqual(BoardLogic.repoKey("/private/tmpfoo"), "/private/tmpfoo")
        XCTAssertEqual(BoardLogic.repoKey("/Users/me/app"), "/Users/me/app")
        let projects = BoardLogic.projects(issueRepos: ["/private/tmp/x/app"], knownRepos: ["/tmp/x/app", "/tmp/x/web"])
        XCTAssertEqual(projects, ["/private/tmp/x/app", "/tmp/x/web"])
    }

    func testSessionTitleMatchesTheTUI() {
        XCTAssertEqual(BoardLogic.sessionTitle(story(12, .open)), "#12 s12")
    }

    func testTaskEventsDecodeWithAndWithoutTail() throws {
        let r = try decode(#"{"events":[{"kind":"tool-start","at":5,"tail":"Bash · claude"},{"kind":"turn-start"}]}"#, as: TaskEventsResult.self)
        XCTAssertEqual(r.events[0].tail, "Bash · claude")
        XCTAssertEqual(r.events[1].tail, "")
        XCTAssertEqual(r.events[1].at, 0)
    }

    // MARK: Routines

    func testRoutineWithAndWithoutOptionalFields() throws {
        let full = try decode(#"""
        {"automations":[{"id":"r1","name":"nightly","repo":"/r/app","prompt":"p","schedule":"0 9 * * *","enabled":false,
          "nextRunAt":"2027-01-01T11:00:00.000Z","vendor":"codex","baseRef":"main","persistentSession":true,
          "precheck":{"command":"git diff --quiet","timeoutSeconds":30},"missedRunGraceMinutes":60}],
         "lastRunStatus":{"r1":"skipped_precheck"},"keepsDaemonAlive":true}
        """#, as: RoutinesPayload.self)
        let r = full.automations[0]
        XCTAssertEqual(r.precheck, RoutinePrecheck(command: "git diff --quiet", timeoutSeconds: 30))
        XCTAssertFalse(r.enabled)
        XCTAssertTrue(r.persistentSession)
        XCTAssertEqual(full.lastRunStatus["r1"], "skipped_precheck")
        XCTAssertTrue(full.keepsDaemonAlive)
        let bare = try decode(#"{"automations":[{"id":"r2","name":"n","repo":"/r","prompt":"p","schedule":"* * * * *","enabled":true,"nextRunAt":"2027-01-01T00:00:00Z"}]}"#, as: RoutinesPayload.self)
        XCTAssertNil(bare.automations[0].precheck)
        XCTAssertNil(bare.automations[0].vendor)
        XCTAssertTrue(bare.lastRunStatus.isEmpty)
        XCTAssertFalse(bare.keepsDaemonAlive)
    }

    func testRoutineRunsWithAndWithoutTaskAndResponse() throws {
        let p = try decode(#"""
        {"runs":[{"id":"x","automationId":"r1","runNumber":3,"status":"dispatched","trigger":"manual","at":"2026-10-05T01:00:00Z","taskId":"T9","tabId":"tab-1","response":{"text":"done","at":"2026-10-05T01:05:00Z"}},
                 {"id":"y","runNumber":2,"status":"skipped_precheck","at":"2026-10-04T01:00:00Z"}]}
        """#, as: RoutineRunsPayload.self)
        XCTAssertEqual(p.runs[0].taskId, "T9")
        XCTAssertEqual(p.runs[0].response?.text, "done")
        XCTAssertNil(p.runs[1].taskId)
        XCTAssertNil(p.runs[1].response)
        XCTAssertEqual(p.runs[1].trigger, "scheduled")
    }

    func testRunTonesKeepSkippedDistinctFromFailed() {
        XCTAssertEqual(RoutineLogic.tone(status: "dispatched"), .success)
        XCTAssertEqual(RoutineLogic.tone(status: "revived"), .success)
        XCTAssertEqual(RoutineLogic.tone(status: "skipped_precheck"), .muted)
        XCTAssertEqual(RoutineLogic.tone(status: "skipped_missed"), .warning)
        XCTAssertEqual(RoutineLogic.tone(status: "dispatch_failed"), .error)
        XCTAssertEqual(RoutineLogic.tone(status: "something_new"), .muted)
        XCTAssertEqual(RoutineLogic.label(status: "skipped_precheck"), "skipped precheck")
    }

    func testNextRunLabels() {
        let now = RoutineLogic.date("2026-10-05T00:00:00Z")!
        XCTAssertEqual(RoutineLogic.until("2026-10-08T00:00:00Z", now: now), "in 3d")
        XCTAssertEqual(RoutineLogic.until("2026-10-05T02:00:00.000Z", now: now), "in 2h")
        XCTAssertEqual(RoutineLogic.until("2026-10-04T00:00:00Z", now: now), "due")
        XCTAssertEqual(RoutineLogic.until(nil, now: now), "—")
        XCTAssertEqual(RoutineLogic.ago("2026-10-04T00:00:00Z", now: now), "1d ago")
    }

    func testScheduleValidationMatchesTheBridge() {
        XCTAssertTrue(RoutineLogic.validSchedule("0 9 * * MON-FRI"))
        XCTAssertTrue(RoutineLogic.validSchedule("*/15 * * * *"))
        XCTAssertTrue(RoutineLogic.validSchedule("  0   9 * * *  "))
        XCTAssertFalse(RoutineLogic.validSchedule("0 9 * *"))
        XCTAssertFalse(RoutineLogic.validSchedule("0 9 * * *; rm -rf /"))
        XCTAssertFalse(RoutineLogic.validSchedule("0 9 * * $(id)"))
        XCTAssertFalse(RoutineLogic.validSchedule(""))
    }

    // MARK: GitHub issues

    func testWorkItemWithAndWithoutOptionalFields() throws {
        let p = try decode(#"""
        {"items":[{"provider":"github","type":"issue","number":12,"title":"Crash","state":"open","url":"https://x/12","updatedAt":"2026-10-04T00:00:00Z","author":"ana","labels":["bug","p1"]},
                  {"number":13}]}
        """#, as: WorkItemsPayload.self)
        XCTAssertEqual(p.items[0].labels, ["bug", "p1"])
        XCTAssertEqual(p.items[0].author, "ana")
        XCTAssertNil(p.items[1].author)
        XCTAssertEqual(p.items[1].labels, [])
        XCTAssertEqual(p.items[1].title, "")
    }

    func testLinkedTaskLookupAndGhErrorHints() throws {
        let links = try decode(#"{"links":[{"number":12,"taskId":"A"}]}"#, as: WorkItemLinksPayload.self).links
        let item = try decode(#"{"number":12}"#, as: WorkItem.self)
        XCTAssertEqual(WorkItemLogic.linkedTask(for: item, in: links), "A")
        XCTAssertNil(WorkItemLogic.linkedTask(for: try decode(#"{"number":99}"#, as: WorkItem.self), in: links))
        XCTAssertEqual(WorkItemLogic.errorHint("no-remote: no GitHub remote found for this repo"), "this repo has no github remote")
        XCTAssertEqual(WorkItemLogic.errorHint("gh-missing: gh not found"), "install the gh cli on the mac")
        XCTAssertEqual(WorkItemLogic.errorHint("auth: not logged in"), "run gh auth login on the mac")
        XCTAssertEqual(WorkItemLogic.errorHint("boom"), "boom")
    }
}

final class SettingsTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String, as: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: Usage

    func testUsageNullEmptyAndFilled() throws {
        XCTAssertNil(try decode(#"{"usage":null}"#, as: UsagePayload.self).usage)
        XCTAssertNil(try decode(#"{}"#, as: UsagePayload.self).usage)
        XCTAssertEqual(try decode(#"{"usage":[]}"#, as: UsagePayload.self).usage?.count, 0)
        let p = try decode(#"""
        {"usage":[{"vendor":"codex","name":"Codex","capturedAt":5,"windows":[{"kind":"primary","label":"7d","percent":100,"resetsAt":1791580432000},{"kind":"session","label":"5h","percent":10,"resetsAt":null}]},
                  {"vendor":"claude","windows":[]}]}
        """#, as: UsagePayload.self)
        XCTAssertEqual(p.usage?[0].displayName, "Codex")
        XCTAssertEqual(p.usage?[0].windows[1].resetsAt, nil)
        XCTAssertEqual(p.usage?[1].displayName, "claude")
        XCTAssertEqual(UsageLogic.worst(p.usage![0])?.label, "7d")
    }

    func testToneThresholdsAreTheTUIs() {
        XCTAssertEqual(UsageTone.of(percent: 0), .ok)
        XCTAssertEqual(UsageTone.of(percent: 74), .ok)
        XCTAssertEqual(UsageTone.of(percent: 75), .warn)
        XCTAssertEqual(UsageTone.of(percent: 94), .warn)
        XCTAssertEqual(UsageTone.of(percent: 95), .crit)
        XCTAssertEqual(UsageTone.of(percent: 100), .crit)
    }

    func testResetTextWithinADayAndBeyond() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let soon = (now.timeIntervalSince1970 + 3600 * 5) * 1000
        let later = (now.timeIntervalSince1970 + 3600 * 60) * 1000
        XCTAssertTrue(UsageLogic.resetText(soon, now: now, calendar: cal).hasPrefix("→ "))
        XCTAssertFalse(UsageLogic.resetText(soon, now: now, calendar: cal).contains("/"))
        XCTAssertTrue(UsageLogic.resetText(later, now: now, calendar: cal).contains("/"))
        XCTAssertEqual(UsageLogic.resetText(nil, now: now, calendar: cal), "")
        XCTAssertEqual(UsageLogic.resetText(now.timeIntervalSince1970 * 1000 - 1, now: now, calendar: cal), "")
    }

    // MARK: Daemon notice

    func testDaemonInfoMinimalAndFull() throws {
        let minimal = try decode(#"{"stale":true}"#, as: DaemonInfo.self)
        XCTAssertTrue(minimal.stale)
        XCTAssertNil(minimal.daemonVersion)
        XCTAssertNil(minimal.uptimeMs)
        let full = try decode(#"{"daemonVersion":"0.9.1","bridgeVersion":"0.9.2","stale":true,"uptimeMs":5,"startedAt":"x","taskCount":3,"attachedClients":1,"automationHold":false}"#, as: DaemonInfo.self)
        XCTAssertEqual(full.taskCount, 3)
        XCTAssertEqual(try decode(#"{"daemonVersion":null}"#, as: DaemonInfo.self).stale, false)
    }

    // MARK: Engines

    func testEngineRowWithAndWithoutOptionalFields() throws {
        let full = try decode(#"""
        {"defaultId":"claude","engines":[{"id":"claude","name":"Claude","builtin":true,"custom":false,"enabled":true,"isDefault":true,"canBeDefault":true,
          "binary":"claude","customized":false,"protocol":null,"binaryFound":true,"binaryPath":"/opt/homebrew/bin/claude","login":"yes",
          "hooks":"installed","markers":true,"screen":false,"configIssue":"refused"}]}
        """#, as: EnginesSettingsPayload.self)
        XCTAssertEqual(full.defaultId, "claude")
        XCTAssertEqual(full.engines[0].binaryPath, "/opt/homebrew/bin/claude")
        XCTAssertEqual(full.engines[0].configIssue, "refused")
        XCTAssertEqual(EngineLogic.loginText(full.engines[0]), "logged in")
        XCTAssertEqual(EngineLogic.reportText(full.engines[0]), "hooks installed · markers · no screen rules")
        let bare = try decode(#"{"engines":[{"id":"gemini"}]}"#, as: EnginesSettingsPayload.self)
        XCTAssertNil(bare.defaultId)
        XCTAssertEqual(bare.engines[0].login, "unknown")
        XCTAssertEqual(bare.engines[0].hooks, "unsupported")
        XCTAssertTrue(bare.engines[0].enabled)
        XCTAssertEqual(EngineLogic.loginText(bare.engines[0]), "login unknown")
        XCTAssertEqual(EngineLogic.reportText(bare.engines[0]), "no hooks · no markers · no screen rules")
    }

    func testTheLastEnabledEngineCannotBeSwitchedOff() throws {
        let on = try decode(#"{"id":"a","enabled":true}"#, as: EngineSetting.self)
        let off = try decode(#"{"id":"b","enabled":false}"#, as: EngineSetting.self)
        let other = try decode(#"{"id":"c","enabled":true}"#, as: EngineSetting.self)
        XCTAssertFalse(EngineLogic.canDisable(on, in: [on, off]))
        XCTAssertTrue(EngineLogic.canDisable(on, in: [on, off, other]))
    }

    // MARK: Plugins

    func testPluginWithAndWithoutLastRun() throws {
        let p = try decode(#"""
        {"plugins":[{"id":"notes","version":"1.0.0","enabled":true,"linked":false,"platformOk":true,"hooksDeclared":true,"updateAvailable":true,
          "declares":{"actions":1,"events":2,"panes":0,"engines":0},"lastRun":{"at":5,"label":"startup","ok":true,"running":false}},
          {"id":"bare"}]}
        """#, as: PluginsPayload.self)
        XCTAssertEqual(p.plugins[0].declares?.events, 2)
        XCTAssertEqual(p.plugins[0].lastRun?.label, "startup")
        XCTAssertNil(p.plugins[1].lastRun)
        XCTAssertNil(p.plugins[1].declares)
        XCTAssertTrue(p.plugins[1].platformOk)
        XCTAssertFalse(p.plugins[1].enabled)
    }

    // MARK: Engine history

    func testHistoryDecodesToolOutputAsStringOrParts() throws {
        let env = try decode(#"""
        {"vendor":"codex","running":true,"taskId":"T","source":"history","cursor":"abc","fallbackReason":null,"warnings":[],
         "history":{"sessionId":"s","returnedMessageCount":3,"totalMessages":3,"limited":false,"messages":[
           {"role":"user","blocks":[{"type":"text","text":"do it"}],"timestamp":"2026-10-05T00:00:00Z"},
           {"role":"assistant","blocks":[{"type":"tool_call","callId":"c","name":"exec","input":"ls"}]},
           {"role":"assistant","blocks":[{"type":"tool_result","callId":"c","output":[{"type":"input_text","text":"a"},{"type":"input_text","text":"b"}]},
                                         {"type":"tool_result","callId":"d","output":"plain"}]}]}}
        """#, as: OutputEnvelope.self)
        XCTAssertEqual(env.source, "history")
        XCTAssertTrue(env.running)
        XCTAssertEqual(env.cursor, "abc")
        let msgs = env.history!.messages
        XCTAssertEqual(msgs.map(\.id), [0, 1, 2])
        XCTAssertEqual(msgs[1].blocks[0].name, "exec")
        XCTAssertEqual(msgs[2].blocks[0].output, "a\nb")
        XCTAssertEqual(msgs[2].blocks[1].output, "plain")
    }

    func testTerminalFallbackEnvelopeWithoutHistory() throws {
        let env = try decode(#"{"source":"terminal","terminal":{"tail":"$ ls","truncated":true,"live":true},"fallbackReason":"no-history","cursor":null}"#, as: OutputEnvelope.self)
        XCTAssertNil(env.history)
        XCTAssertEqual(env.terminal?.tail, "$ ls")
        XCTAssertEqual(env.fallbackReason, "no-history")
        XCTAssertFalse(env.running)
        XCTAssertTrue(env.warnings.isEmpty)
    }

    // MARK: Digest and turns

    func testDigestAndTurns() throws {
        let d = try decode(#"{"repo":"/r","since":"x","tasks":{"total":3},"routines":{"runs":2,"byStatus":{"dispatched":1,"skipped_precheck":1}}}"#, as: DigestResult.self)
        XCTAssertEqual(d.tasksTotal, 3)
        XCTAssertEqual(d.byStatus["skipped_precheck"], 1)
        let empty = try decode(#"{"repo":"/r","since":"x"}"#, as: DigestResult.self)
        XCTAssertEqual(empty.tasksTotal, 0)
        XCTAssertTrue(empty.byStatus.isEmpty)
        let t = try decode(#"""
        {"since":"x","totals":{"turns":2,"inputTokens":3192,"outputTokens":478,"cacheReadTokens":493056,"cacheCreationTokens":0,"durationMs":198691,"byModel":{"gpt-6-astra":2}},
         "turns":[{"id":"a","taskId":"T","vendor":"codex","model":"gpt-6-astra","startedAt":1000,"endedAt":4000,"usage":{"input_tokens":1}},{"id":"b","startedAt":5,"endedAt":2}]}
        """#, as: TurnsResult.self)
        XCTAssertEqual(t.totals.byModel["gpt-6-astra"], 2)
        XCTAssertEqual(t.turns[0].durationMs, 3000)
        XCTAssertEqual(t.turns[1].durationMs, 0)
        XCTAssertNil(t.turns[1].model)
        XCTAssertEqual(InsightLogic.compact(999), "999")
        XCTAssertEqual(InsightLogic.compact(3192), "3.2k")
        XCTAssertEqual(InsightLogic.compact(493056), "493k")
        XCTAssertEqual(InsightLogic.compact(2_400_000), "2.4m")
    }

    // MARK: Notifications switch

    func testNotificationSwitchDefaultsOnAndOnlyAStoredFalseTurnsItOff() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "rove.tests.notifications"))
        defaults.removePersistentDomain(forName: "rove.tests.notifications")
        XCTAssertTrue(NotificationPrefs.enabled(in: defaults))
        defaults.set(false, forKey: NotificationPrefs.key)
        XCTAssertFalse(NotificationPrefs.enabled(in: defaults))
        defaults.set(true, forKey: NotificationPrefs.key)
        XCTAssertTrue(NotificationPrefs.enabled(in: defaults))
        defaults.removePersistentDomain(forName: "rove.tests.notifications")
    }
}
