import XCTest

/// Screenshot-only walk over every top-level screen, for the design review rounds.
/// Needs ROVE_BRIDGE_URL, ROVE_TASK_TITLE and ROVE_SHOT_DIR (see scripts/shot-watcher.sh); changes nothing on the Mac.
final class RoundScreensTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func checkpoint(_ name: String) {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { return }
        let ready = (dir as NSString).appendingPathComponent(name + ".ready")
        let done = (dir as NSString).appendingPathComponent(name + ".done")
        FileManager.default.createFile(atPath: ready, contents: Data())
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, !FileManager.default.fileExists(atPath: done) { Thread.sleep(forTimeInterval: 0.2) }
    }

    @discardableResult
    private func waitFor(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 20) -> XCUIElement {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "timed out waiting for \(what)")
        return e
    }

    private func back() { waitFor(element("backButton"), "back").tap() }

    private func openPage(_ name: String) {
        waitFor(element("pagesMenu"), "pages menu").tap()
        waitFor(element("page-\(name)"), "\(name) in pages menu").tap()
        Thread.sleep(forTimeInterval: 2.5)
    }

    func testRoundScreens() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty,
              let taskTitle = env["ROVE_TASK_TITLE"], !taskTitle.isEmpty,
              env["ROVE_SHOT_DIR"]?.isEmpty == false else {
            throw XCTSkip("ROVE_BRIDGE_URL / ROVE_TASK_TITLE / ROVE_SHOT_DIR not set")
        }
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        if let lang = env["ROVE_LANG"], !lang.isEmpty { app.launchArguments += ["-AppleLanguages", "(\(lang))"] }
        app.launch()
        // The notification prompt is springboard's, in the simulator's language.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(NSPredicate(format: "label IN {'Allow', '允许'}")).firstMatch
        if allow.waitForExistence(timeout: 3) { allow.tap() }

        let field = waitFor(element("pairingField"), "pairing field")
        field.tap()
        field.typeText(url)
        if element("keyboardDone").waitForExistence(timeout: 3) { element("keyboardDone").tap() }
        element("connectButton").tap()

        waitFor(element("newTaskButton"), "task list")
        waitFor(app.staticTexts[taskTitle].firstMatch, "task row", timeout: 30)
        Thread.sleep(forTimeInterval: 2)
        checkpoint("r-list")

        waitFor(element("inboxButton"), "inbox").tap()
        Thread.sleep(forTimeInterval: 2)
        checkpoint("r-inbox")
        back()

        for page in ["board", "routines", "issues", "worktrees"] {
            openPage(page)
            if page == "board", let repo = env["ROVE_BOARD_REPO"], app.buttons[repo].firstMatch.exists {
                app.buttons[repo].firstMatch.tap()
                Thread.sleep(forTimeInterval: 2)
            }
            checkpoint("r-\(page)")
            back()
        }

        waitFor(element("settingsButton"), "settings").tap()
        Thread.sleep(forTimeInterval: 2.5)
        checkpoint("r-settings")
        back()

        element("newTaskButton").tap()
        Thread.sleep(forTimeInterval: 2.5)
        checkpoint("r-newtask")
        waitFor(element("sheetClose"), "close new task").tap()

        waitFor(app.staticTexts[taskTitle].firstMatch, "task row").tap()
        waitFor(element("taskTitle"), "task detail")
        Thread.sleep(forTimeInterval: 6)
        checkpoint("r-detail")

        waitFor(element("diffLink"), "diff").tap()
        Thread.sleep(forTimeInterval: 3)
        checkpoint("r-diff")
    }
}
