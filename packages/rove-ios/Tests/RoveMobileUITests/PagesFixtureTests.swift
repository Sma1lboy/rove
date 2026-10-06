import XCTest

/// Screenshot-and-tap checks for states a sandbox Rove cannot produce on demand: a stale daemon,
/// warn/crit quota meters, installed plugins, GitHub issues with a linked task, every routine run
/// tone, a need-you card floating on the board. They run against the canned-answer bridge in
/// scripts/fixture-bridge.ts (`bun packages/rove-ios/scripts/fixture-bridge.ts`), so they need
/// TEST_RUNNER_ROVE_FIXTURE_URL=ws://127.0.0.1:7896/?token=fixture (+ ROVE_SHOT_DIR, ROVE_SHOT_PREFIX)
/// and are skipped otherwise.
/// `testHistorySheet` runs against the real sandbox bridge (ROVE_BRIDGE_URL, ROVE_TASK_TITLE).
final class PagesFixtureTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private func text(_ s: String) -> XCUIElement { app.staticTexts[s].firstMatch }
    private func button(_ label: String) -> XCUIElement { app.buttons[label].firstMatch }
    private func button(startingWith prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func checkpoint(_ name: String) {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { return }
        let full = (env["ROVE_SHOT_PREFIX"] ?? "") + name
        let ready = (dir as NSString).appendingPathComponent(full + ".ready")
        let done = (dir as NSString).appendingPathComponent(full + ".done")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: ready, contents: Data())
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, !FileManager.default.fileExists(atPath: done) { Thread.sleep(forTimeInterval: 0.2) }
    }

    @discardableResult
    private func waitFor(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 20) -> XCUIElement {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "timed out waiting for \(what)")
        return e
    }

    private func hideKeyboard() {
        let done = element("keyboardDone")
        if done.waitForExistence(timeout: 3) { done.tap() }
        Thread.sleep(forTimeInterval: 0.6)
    }

    private func pair(_ url: String) {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let field = waitFor(element("pairingField"), "pairing field")
        field.tap()
        field.typeText(url)
        hideKeyboard()
        element("connectButton").tap()
        waitFor(element("newTaskButton"), "task list")
    }

    private func openPage(_ name: String) {
        waitFor(element("pagesMenu"), "pages menu").tap()
        waitFor(button(name), "\(name) in pages menu").tap()
    }

    private func fixture() throws -> String {
        guard let url = env["ROVE_FIXTURE_URL"], !url.isEmpty else { throw XCTSkip("ROVE_FIXTURE_URL not set") }
        return url
    }

    func testFixtureBoard() throws {
        pair(try fixture())
        openPage("board")
        waitFor(element("boardNewStory"), "board")
        waitFor(element("boardNeedYou"), "need-you count", timeout: 20)
        Thread.sleep(forTimeInterval: 1)
        checkpoint("fx-board-1-in-progress")
        // The need-you card floats to the head of in progress.
        let first = element("storyCard-8")
        waitFor(first, "story 8")
        button(startingWith: "backlog").tap()
        Thread.sleep(forTimeInterval: 0.5)
        checkpoint("fx-board-2-backlog")
        button(startingWith: "parked").tap()
        checkpoint("fx-board-3-parked")
        button(startingWith: "done").tap()
        checkpoint("fx-board-4-done")
        button(startingWith: "in progress").tap()
        first.tap()
        waitFor(element("drawerEvents"), "events", timeout: 20)
        Thread.sleep(forTimeInterval: 1)
        checkpoint("fx-board-5-linked-drawer")
    }

    func testFixtureRoutinesAndIssues() throws {
        pair(try fixture())
        openPage("routines")
        waitFor(element("routineRow-r-ok"), "routine rows")
        Thread.sleep(forTimeInterval: 1)
        checkpoint("fx-routines-1-list")
        element("routineRow-r-ok").tap()
        waitFor(element("routineRun-x4"), "runs", timeout: 20)
        checkpoint("fx-routines-2-detail")
        app.swipeUp()
        app.swipeUp()
        Thread.sleep(forTimeInterval: 0.6)
        checkpoint("fx-routines-3-detail-runs")
        element("sheetClose").tap()
        Thread.sleep(forTimeInterval: 1)
        element("backButton").tap()

        openPage("github issues")
        waitFor(element("issueRow-214"), "issue rows", timeout: 20)
        Thread.sleep(forTimeInterval: 1)
        checkpoint("fx-issues-1-list")
        element("issueRow-214").tap()
        waitFor(element("startIssueTask"), "start sheet")
        checkpoint("fx-issues-2-start")
    }

    func testFixtureSettings() throws {
        pair(try fixture())
        waitFor(element("settingsButton"), "gear").tap()
        waitFor(element("daemonStaleNotice"), "stale daemon notice", timeout: 20)
        Thread.sleep(forTimeInterval: 1)
        checkpoint("fx-settings-1-home")
        element("settingsRow-usage").tap()
        waitFor(element("usageVendor-claude"), "usage", timeout: 20)
        checkpoint("fx-settings-2-usage")
        element("backButton").tap()
        element("settingsRow-engines").tap()
        waitFor(element("engineRow-mine"), "engines", timeout: 20)
        checkpoint("fx-settings-3-engines")
        element("engineRow-mine").tap()
        waitFor(element("engineReset"), "reset").tap()
        waitFor(element("confirmAction"), "confirm")
        checkpoint("fx-settings-4-remove-engine-confirm")
        element("sheetClose").tap()
        Thread.sleep(forTimeInterval: 1) // the confirmation closes first, the engine sheet behind it second
        element("sheetClose").tap()
        Thread.sleep(forTimeInterval: 1)
        element("backButton").tap()
        element("settingsRow-plugins").tap()
        waitFor(element("pluginRow-notes"), "plugins", timeout: 20)
        checkpoint("fx-settings-5-plugins")
        element("pluginToggle-notes").tap()
        waitFor(element("confirmAction"), "plugin confirm")
        checkpoint("fx-settings-6-plugin-confirm")
    }

    /// The engine-history sheet of a real task (the sandbox's codex task with a structured transcript).
    func testHistorySheet() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty,
              let title = env["ROVE_TASK_TITLE"], !title.isEmpty else { throw XCTSkip("ROVE_BRIDGE_URL / ROVE_TASK_TITLE not set") }
        pair(url)
        waitFor(text(title), "task row", timeout: 30).tap()
        waitFor(element("moreMenu"), "more menu").tap()
        waitFor(element("historyButton"), "history entry").tap()
        waitFor(element("historyTranscript"), "transcript", timeout: 30)
        Thread.sleep(forTimeInterval: 1)
        checkpoint("history-1-transcript")
    }
}
