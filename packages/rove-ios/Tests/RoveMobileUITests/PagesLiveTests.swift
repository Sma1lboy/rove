import XCTest

/// Live taps through Board, Routines, GitHub issues and Settings against a real rove-bridge and a
/// sandbox Rove. Skipped unless ROVE_BRIDGE_URL is set (pass with TEST_RUNNER_ROVE_BRIDGE_URL,
/// TEST_RUNNER_ROVE_SHOT_DIR, TEST_RUNNER_ROVE_SHOT_PREFIX, TEST_RUNNER_ROVE_DEMO_REPO_NAME).
/// Screenshots go through scripts/shot-watcher.sh like LiveFlowTests. Nothing is sent to GitHub:
/// the feedback test stops at the confirmation sheet.
final class PagesLiveTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!
    private var repoName: String { env["ROVE_DEMO_REPO_NAME"] ?? "payments-api" }

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

    private func gone(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 20) {
        let exp = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: e)
        wait(for: [exp], timeout: timeout)
        XCTAssertFalse(e.exists, "\(what) is still there")
    }

    private func hideKeyboard() {
        let done = element("keyboardDone")
        if done.waitForExistence(timeout: 3) { done.tap() }
        Thread.sleep(forTimeInterval: 0.6)
    }

    private func type(_ id: String, _ value: String) {
        let field = waitFor(element(id), id)
        field.tap()
        field.typeText(value)
        hideKeyboard()
    }

    private func pair() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty else { throw XCTSkip("ROVE_BRIDGE_URL not set") }
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

    // MARK: Board

    func testBoardFlow() throws {
        try pair()
        openPage("board")
        waitFor(element("boardNewStory"), "board")
        Thread.sleep(forTimeInterval: 2)
        checkpoint("board-1-initial")

        // File a story.
        element("boardNewStory").tap()
        type("newStoryTitle", "Phone smoke story")
        let body = waitFor(element("newStoryDescription"), "description")
        body.tap(); body.typeText("Reply with the single word PONG and nothing else."); hideKeyboard()
        checkpoint("board-2-new-story")
        element("newStorySave").tap()
        let card = waitFor(text("Phone smoke story"), "the new card", timeout: 20)
        checkpoint("board-3-backlog")

        // Drawer: park it, then bring it back.
        card.tap()
        waitFor(element("drawerTitle"), "drawer")
        checkpoint("board-4-drawer")
        button("hold").tap()
        element("drawerSave").tap()
        waitFor(button(startingWith: "parked 1"), "parked column count", timeout: 20)
        button(startingWith: "parked").tap()
        waitFor(text("Phone smoke story"), "card in parked").tap()
        waitFor(element("drawerTitle"), "drawer again")
        button("open").tap()
        element("drawerSave").tap()
        waitFor(button(startingWith: "backlog"), "backlog tile")
        button(startingWith: "backlog").tap()

        // Start a real session from the card and stay on the board.
        waitFor(text("Phone smoke story"), "card back in backlog").tap()
        waitFor(element("startSession"), "start session").tap()
        waitFor(button("codex"), "codex tile", timeout: 20).tap()
        button("stay on board").tap()
        checkpoint("board-5-start-sheet")
        element("startSessionSubmit").tap()
        waitFor(element("boardNotice"), "background notice", timeout: 60)
        checkpoint("board-6-started")
        button(startingWith: "in progress").tap()
        let linked = waitFor(text("Phone smoke story"), "card in progress", timeout: 20)
        checkpoint("board-7-in-progress")

        // The linked drawer: events snapshot, open task.
        linked.tap()
        waitFor(element("drawerEvents"), "events snapshot", timeout: 20)
        checkpoint("board-8-linked-drawer")
        element("openTask").tap()
        waitFor(element("taskTitle"), "the linked task", timeout: 30)
        checkpoint("board-9-task-opened")
        element("backButton").tap()
        waitFor(element("boardNewStory"), "back on the board")

        // Delete the record, with the second confirmation.
        button(startingWith: "in progress").tap()
        waitFor(text("Phone smoke story"), "card").tap()
        waitFor(element("deleteStory"), "delete story").tap()
        checkpoint("board-10-delete-confirm")
        waitFor(element("confirmDeleteStory"), "confirm delete").tap()
        gone(text("Phone smoke story"), "the deleted story")
        checkpoint("board-11-deleted")
    }

    /// The verb refuses an empty --body, so the drawer clears through `clearBody`; the description
    /// must read empty afterwards, not keep its old text.
    func testStoryClearDescription() throws {
        try pair()
        openPage("board")
        waitFor(element("boardNewStory"), "board").tap()
        type("newStoryTitle", "Clear description smoke")
        let body = waitFor(element("newStoryDescription"), "description")
        body.tap(); body.typeText("remove me"); hideKeyboard()
        element("newStorySave").tap()
        waitFor(text("Clear description smoke"), "the new card").tap()
        let editor = waitFor(element("drawerDescription"), "drawer description")
        // Triple tap selects the whole paragraph (a plain tap lands the caret at the start).
        editor.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        editor.typeText(XCUIKeyboardKey.delete.rawValue)
        hideKeyboard()
        XCTAssertTrue(text("what and why, in a few lines").waitForExistence(timeout: 5), "the editor still has text")
        element("drawerSave").tap()
        gone(element("drawerTitle"), "the drawer")
        waitFor(text("Clear description smoke"), "card after save").tap()
        waitFor(element("drawerDescription"), "drawer again")
        XCTAssertTrue(text("what and why, in a few lines").waitForExistence(timeout: 5), "description was not cleared")
        checkpoint("board-12-cleared-description")
        waitFor(element("deleteStory"), "delete story").tap()
        waitFor(element("confirmDeleteStory"), "confirm delete").tap()
        gone(text("Clear description smoke"), "the deleted story")
    }

    // MARK: Routines

    func testRoutinesFlow() throws {
        try pair()
        openPage("routines")
        waitFor(element("routineNew"), "routines page")
        Thread.sleep(forTimeInterval: 1.5)
        checkpoint("routines-1-initial")

        element("routineNew").tap()
        type("routineName", "phone smoke routine")
        waitFor(element("routineRepo-\(repoName)"), "repo tile").tap()
        let prompt = waitFor(element("routinePrompt"), "prompt")
        prompt.tap(); prompt.typeText("Reply with the single word PONG and nothing else."); hideKeyboard()
        waitFor(button("daily 9:00"), "daily preset").tap()
        checkpoint("routines-2-create")
        element("createRoutine").tap()
        let row = waitFor(text("phone smoke routine"), "the new routine", timeout: 20)
        checkpoint("routines-3-list")

        row.tap()
        waitFor(element("routineRunNow"), "routine detail")
        checkpoint("routines-4-detail")
        element("routineRunNow").tap()
        waitFor(app.buttons["run now"].firstMatch, "run now confirmation").tap()
        waitFor(element("routineOpenTask"), "open task action")
        let start = Date().addingTimeInterval(60)
        while Date() < start, !element("routineOpenTask").isEnabled { Thread.sleep(forTimeInterval: 1) }
        Thread.sleep(forTimeInterval: 2)
        checkpoint("routines-5-ran")

        // Pause and resume.
        element("routineToggle").tap()
        Thread.sleep(forTimeInterval: 1.5)
        checkpoint("routines-6-paused")
        element("routineToggle").tap()
        Thread.sleep(forTimeInterval: 1.5)

        // Open the latest run's task, then come back.
        element("routineOpenTask").tap()
        waitFor(element("taskTitle"), "the run's task", timeout: 30)
        checkpoint("routines-7-run-task")
        element("backButton").tap()

        // Delete: confirm sheet.
        waitFor(text("phone smoke routine"), "routine row").tap()
        waitFor(element("routineDelete"), "delete action").tap()
        checkpoint("routines-8-delete-confirm")
        waitFor(element("confirmDeleteRoutine"), "confirm").tap()
        gone(text("phone smoke routine"), "the deleted routine")
        checkpoint("routines-9-deleted")
    }

    // MARK: GitHub issues

    func testIssuesFlow() throws {
        try pair()
        openPage("github issues")
        waitFor(element("issuesRefresh"), "issues page")
        // The sandbox repo has no GitHub remote: the failure must read cleanly, with a retry.
        waitFor(text("this repo has no github remote"), "clean gh error", timeout: 30)
        checkpoint("issues-1-error")
        waitFor(button("retry"), "retry").tap()
        waitFor(text("this repo has no github remote"), "error after retry", timeout: 30)
        button("assigned to me").tap()
        waitFor(text("this repo has no github remote"), "error under filter", timeout: 30)
        checkpoint("issues-2-filter")
    }

    // MARK: Settings

    func testSettingsFlow() throws {
        try pair()
        waitFor(element("settingsButton"), "gear").tap()
        waitFor(element("settingsRow-usage"), "settings home")
        Thread.sleep(forTimeInterval: 2)
        checkpoint("settings-1-home")

        element("settingsRow-usage").tap()
        waitFor(element("usageVendor-codex"), "codex usage", timeout: 20)
        checkpoint("settings-2-usage")
        element("backButton").tap()

        element("settingsRow-engines").tap()
        let codex = waitFor(element("engineRow-codex"), "codex row", timeout: 30)
        checkpoint("settings-3-engines")
        codex.tap()
        waitFor(element("engineSwitchOff"), "switch off").tap()
        checkpoint("settings-4-engine-confirm")
        waitFor(element("confirmAction"), "confirm").tap()
        waitFor(element("engineSwitchOn"), "now off", timeout: 20)
        checkpoint("settings-5-engine-off")
        element("engineSwitchOn").tap()
        waitFor(element("confirmAction"), "confirm on").tap()
        waitFor(element("engineSwitchOff"), "back on", timeout: 20)
        element("sheetClose").tap()
        element("backButton").tap()

        element("settingsRow-plugins").tap()
        Thread.sleep(forTimeInterval: 2)
        checkpoint("settings-6-plugins")
        element("backButton").tap()

        element("settingsRow-notifications").tap()
        waitFor(element("notificationsToggle"), "toggle")
        button("off").tap()
        checkpoint("settings-7-notifications-off")
        button("on").tap()
        element("backButton").tap()

        element("settingsRow-activity").tap()
        waitFor(element("activityDigest"), "digest", timeout: 20)
        Thread.sleep(forTimeInterval: 1)
        checkpoint("settings-8-activity")
        element("backButton").tap()

        element("settingsRow-feedback").tap()
        type("feedbackTitle", "phone smoke")
        let body = waitFor(element("feedbackBody"), "body")
        body.tap(); body.typeText("test only, never sent"); hideKeyboard()
        element("feedbackSend").tap()
        waitFor(element("confirmAction"), "feedback confirm sheet")
        checkpoint("settings-9-feedback-confirm")
        element("sheetClose").tap()
        element("backButton").tap()

        element("settingsRow-about").tap()
        Thread.sleep(forTimeInterval: 2)
        checkpoint("settings-10-about")
        element("backButton").tap()

        element("settingsRow-bridge").tap()
        waitFor(element("pairingField"), "pairing screen")
        checkpoint("settings-11-bridge")
    }
}
