import XCTest

/// The reviewer demo: `try a demo` on the pairing screen runs the whole app against the fixture bridge
/// inside the app. Needs no bridge and no env, so it runs in CI. (ROVE_SHOT_DIR + scripts/shot-watcher.sh
/// turn its checkpoints into the beta-review screenshots; without it they do nothing.)
final class DemoModeTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private func text(_ s: String) -> XCUIElement { app.staticTexts[s].firstMatch }

    private func checkpoint(_ name: String) {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { return }
        let ready = (dir as NSString).appendingPathComponent(name + ".ready")
        let done = (dir as NSString).appendingPathComponent(name + ".done")
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

    /// Cold launch, unpaired, with the first-run notification prompt answered.
    private func launch(resetPairing: Bool = true) {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = resetPairing ? ["-resetPairing"] : []
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
    }

    private func startDemo() {
        waitFor(element("demoButton"), "try a demo").tap()
        waitFor(element("newTaskButton"), "task list in demo")
        assertStrip()
    }

    /// The strip is on every screen: its words, and the button that leaves.
    private func assertStrip(_ screen: String = "list") {
        XCTAssertEqual(waitFor(element("demoStatus"), "demo strip on \(screen)").label, "demo · not connected to a mac")
        XCTAssertTrue(element("demoConnect").exists, "connect a mac on \(screen)")
    }

    private func openPage(_ id: String) {
        waitFor(element("pagesMenu"), "pages menu").tap()
        waitFor(element(id), id).tap()
    }

    private func back() {
        element("backButton").tap()
        waitFor(element("newTaskButton"), "task list")
    }

    private func terminalBytes() -> Int { Int(element("terminal").value as? String ?? "") ?? 0 }

    func testPairingScreenOffersDemoAndConnectAMacLeavesIt() {
        launch()
        waitFor(element("pairingField"), "pairing field")
        XCTAssertFalse(element("demoStatus").exists, "no demo strip before the demo")
        checkpoint("demo-pair")
        startDemo()
        waitFor(element("task-T-WAIT"), "fixture task")
        checkpoint("demo-list")

        element("demoConnect").tap()
        waitFor(element("demoButton"), "pairing screen after leaving the demo")
        XCTAssertFalse(element("demoStatus").exists)
        XCTAssertFalse(element("task-T-WAIT").exists, "demo rows are gone")
    }

    func testTaskDetailTerminalAndDiff() {
        launch()
        startDemo()
        waitFor(text("Verify refund webhook signatures"), "task row")
        waitFor(text("Add pagination to invoices"), "second task row")
        element("task-T-WAIT").tap()

        waitFor(element("taskTitle"), "task detail")
        assertStrip("task detail")
        waitFor(element("tab-tab-1"), "codex tab")
        waitFor(element("terminal"), "terminal")
        let deadline = Date().addingTimeInterval(20)
        while terminalBytes() == 0, Date() < deadline { Thread.sleep(forTimeInterval: 0.3) }
        XCTAssertGreaterThan(terminalBytes(), 0, "the replay never reached the terminal")
        Thread.sleep(forTimeInterval: 1.5)
        checkpoint("demo-detail")

        element("diffLink").tap()
        assertStrip("diff files")
        let file = waitFor(element("file-src/refunds/webhook.ts"), "changed file")
        XCTAssertTrue(element("file-src/refunds/signature.ts").exists)
        file.tap()
        waitFor(element("mentionButton"), "diff file")
        waitFor(element("notesButton"), "review note on the file")
        assertStrip("diff file")
        Thread.sleep(forTimeInterval: 1.5)
        checkpoint("demo-diff")
    }

    func testPagesInboxAndSettings() {
        launch()
        startDemo()

        element("inboxButton").tap()
        waitFor(element("nextPending"), "inbox with blocked items")
        waitFor(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'attention-T-WAIT'")).firstMatch, "attention row")
        assertStrip("inbox")
        back()

        openPage("page-board")
        waitFor(element("boardNewStory"), "board")
        waitFor(element("storyCard-8"), "story card")
        waitFor(element("boardNeedYou"), "need-you count")
        assertStrip("board")
        back()

        openPage("page-routines")
        waitFor(element("routineRow-r-ok"), "routine row")
        assertStrip("routines")
        back()

        openPage("page-issues")
        waitFor(element("issueRow-214"), "github issue")
        assertStrip("issues")
        back()

        openPage("page-worktrees")
        waitFor(element("worktree-/work/payments-api/.rove/worktrees/feat-audit-export"), "worktree row")
        assertStrip("worktrees")
        back()

        element("settingsButton").tap()
        waitFor(element("daemonStaleNotice"), "settings home")
        assertStrip("settings")
        element("settingsRow-usage").tap()
        waitFor(element("usageVendor-claude"), "usage meters")
        assertStrip("usage")
    }

    func testDemoIsNotPersisted() {
        launch()
        startDemo()
        app.terminate()
        launch(resetPairing: false)
        waitFor(element("pairingField"), "pairing screen on a cold launch")
        XCTAssertFalse(element("demoStatus").exists)
        XCTAssertFalse(element("newTaskButton").exists)
    }
}
