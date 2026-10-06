import XCTest

/// Task-area parity walk against a real rove-bridge in a sandbox Rove. Skipped unless
/// ROVE_BRIDGE_URL is set (TEST_RUNNER_ROVE_BRIDGE_URL, TEST_RUNNER_ROVE_SHOT_DIR, optional
/// TEST_RUNNER_ROVE_SHOT_SUFFIX = light|dark). Creates one throwaway task and deletes it.
final class TasksParityTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func shot(_ name: String) {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { return }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let suffix = env["ROVE_SHOT_SUFFIX"] ?? "light"
        Thread.sleep(forTimeInterval: 0.8)
        let png = XCUIScreen.main.screenshot().pngRepresentation
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name)-\(suffix).png"))
    }

    @discardableResult
    private func waitFor(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 20) -> XCUIElement {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "timed out waiting for \(what)")
        return e
    }

    private func hideKeyboard() {
        let done = element("keyboardDone")
        if done.waitForExistence(timeout: 2) { done.tap() }
        Thread.sleep(forTimeInterval: 0.5)
    }

    /// Open the `…` menu on the detail screen and tap one action.
    private func act(_ id: String) {
        for attempt in 0..<3 {
            Thread.sleep(forTimeInterval: 1.2)
            element("moreMenu").tap()
            if element(id).waitForExistence(timeout: 4) { break }
            if attempt < 2 { dismissMenu() }
        }
        waitFor(element(id), "menu item \(id)").tap()
    }

    /// Tap the right edge, outside any menu the app opens (a list row's context menu, the detail `…`
    /// menu, a project menu) and outside the rows: closes the menu without hitting anything. The
    /// strip under the status bar no longer receives the dismissing tap.
    private func dismissMenu() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).tap()
        Thread.sleep(forTimeInterval: 0.5)
    }

    /// Close the open sheet and wait for it to be gone: a tap that lands mid-dismissal is swallowed.
    private func closeSheet() {
        element("sheetClose").tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element("sheetClose"))
        wait(for: [gone], timeout: 10)
    }

    func testTasksParity() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty else { throw XCTSkip("ROVE_BRIDGE_URL not set") }
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }

        let field = waitFor(element("pairingField"), "pairing field")
        field.tap(); field.typeText(url); hideKeyboard()
        element("connectButton").tap()
        waitFor(element("newTaskButton"), "task list")
        Thread.sleep(forTimeInterval: 3)
        shot("01-list")

        // Search (fuzzy) + sort
        element("searchButton").tap()
        let search = waitFor(element("searchField"), "search field")
        search.tap(); search.typeText("pmt")
        hideKeyboard()
        shot("02-search")
        search.tap(); search.typeText("zzzzzz"); hideKeyboard()
        waitFor(element("noMatches"), "no matches state")
        shot("03-no-matches")
        element("searchButton").tap()
        element("sortMenu").tap()
        shot("04-sort-menu")
        app.buttons["name"].firstMatch.tap()
        Thread.sleep(forTimeInterval: 0.5)
        shot("05-sorted-name")

        // Row long-press menu
        let anyRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'task-'")).firstMatch
        waitFor(anyRow, "a task row")
        anyRow.press(forDuration: 1.0)
        waitFor(element("actionRename"), "context menu")
        shot("06-row-context")
        dismissMenu()
        Thread.sleep(forTimeInterval: 0.5)

        // Project menu
        let projectMenu = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'projectMenu-'")).firstMatch
        if projectMenu.waitForExistence(timeout: 3) {
            if !projectMenu.isHittable { app.swipeDown() }
            projectMenu.tap(); shot("07-project-menu"); dismissMenu()
            if element("projectNotes").exists { dismissMenu() }
        }
        Thread.sleep(forTimeInterval: 0.5)

        // New task sheet: modes
        element("newTaskButton").tap()
        if !app.buttons["existing"].firstMatch.waitForExistence(timeout: 4) { element("newTaskButton").tap() }
        waitFor(app.buttons["existing"].firstMatch, "mode tiles")
        shot("08-new-existing")
        element("optionsToggle").tap()
        shot("09-new-options")
        app.buttons["open project"].firstMatch.tap(); shot("10-new-open")
        app.buttons["clone"].firstMatch.tap(); shot("11-new-clone")
        app.buttons["adopt"].firstMatch.tap(); Thread.sleep(forTimeInterval: 1.5); shot("12-new-adopt")
        app.buttons["existing"].firstMatch.tap()

        // Create a throwaway task (no prompt: worktree only)
        let titleField = waitFor(element("titleField"), "title field")
        titleField.tap(); titleField.typeText("par ui test"); hideKeyboard()
        element("createButton").tap()
        let heading = waitFor(element("taskTitle"), "task detail", timeout: 40)
        XCTAssertEqual(heading.label, "par ui test")
        shot("13-detail")

        // Actions menu
        element("moreMenu").tap()
        waitFor(element("actionRename"), "actions menu")
        shot("14-actions-menu")
        element("actionRename").tap()
        let rename = waitFor(element("renameField"), "rename field")
        rename.tap()
        rename.press(forDuration: 1.0)
        if app.menuItems["Select All"].waitForExistence(timeout: 2) { app.menuItems["Select All"].tap() }
        rename.typeText("par ui renamed"); hideKeyboard()
        shot("15-rename")
        element("renameConfirm").tap()
        let renamed = NSPredicate(format: "label == 'par ui renamed'")
        expectation(for: renamed, evaluatedWith: element("taskTitle"))
        waitForExpectations(timeout: 20)

        // Status
        act("actionStatus")
        waitFor(element("status-in_review"), "status tiles").tap()
        shot("16-status")
        element("statusConfirm").tap()
        Thread.sleep(forTimeInterval: 1)

        // Pin
        act("actionPin")
        Thread.sleep(forTimeInterval: 1.5)
        shot("17-after-pin")

        // Info sheet
        act("actionInfo")
        Thread.sleep(forTimeInterval: 2)
        shot("18-info")
        closeSheet()

        // Model & effort, engine, branch sheets
        act("actionBranch")
        waitFor(element("branchField"), "branch sheet"); Thread.sleep(forTimeInterval: 1.5)
        shot("19-branch")
        closeSheet()
        act("actionModel")
        Thread.sleep(forTimeInterval: 1.5); shot("20-model-effort")
        closeSheet()

        // Back to the list: pinned mark visible
        element("backButton").tap()
        waitFor(element("newTaskButton"), "task list")
        Thread.sleep(forTimeInterval: 1.5)
        shot("21-list-pinned")

        // Delete via the row long-press menu (kind-aware flow, second confirmation)
        let row = app.staticTexts["par ui renamed"].firstMatch
        waitFor(row, "renamed row")
        row.press(forDuration: 1.0)
        waitFor(element("deleteButton"), "delete in context menu").tap()
        waitFor(app.buttons["Delete…"].firstMatch, "first confirmation").tap()
        waitFor(element("confirmDeleteButton"), "second confirmation")
        shot("22-delete-confirm")
        element("confirmDeleteButton").tap()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.staticTexts["par ui renamed"])
        waitForExpectations(timeout: 40)
        shot("23-deleted")
    }
}
