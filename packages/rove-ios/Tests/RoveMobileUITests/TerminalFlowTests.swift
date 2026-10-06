import XCTest

/// Terminal-parity smoke against a real rove-bridge (skips unless ROVE_BRIDGE_URL and ROVE_TASK_TITLE are set;
/// pass them with the TEST_RUNNER_ prefix). ROVE_TASK_TITLE names a task of yours that has an attention item and a
/// live engine tab. ROVE_SHOT_DIR collects screenshots; ROVE_NOTIFY_WAIT (seconds) waits for a `rove api notify`
/// toast fired from outside.
final class TerminalFlowTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    @discardableResult
    private func waitFor(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 20) -> XCUIElement {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "timed out waiting for \(what)")
        return e
    }

    private func shot(_ name: String) {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { return }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        Thread.sleep(forTimeInterval: 0.8)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png"))
    }

    private func hideKeyboard() {
        let done = element("keyboardDone")
        if done.waitForExistence(timeout: 2) { done.tap() }
        Thread.sleep(forTimeInterval: 0.5)
    }

    func testTerminalParity() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty, let title = env["ROVE_TASK_TITLE"], !title.isEmpty else {
            throw XCTSkip("ROVE_BRIDGE_URL / ROVE_TASK_TITLE not set")
        }
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
        waitFor(app.staticTexts[title].firstMatch, "scratch task row", timeout: 30)
        shot("01-list")

        // I1/I3/I4: the bell opens the Inbox; entering an item lands on its exact tab.
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Attention'")).firstMatch.tap()
        waitFor(app.staticTexts["ATTENTION"].firstMatch, "attention section")
        waitFor(app.staticTexts["RECENT"].firstMatch, "recent section")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'attention-' AND label CONTAINS %@", title)).firstMatch
        waitFor(row, "scratch attention row")
        shot("02-inbox")
        row.tap()
        XCTAssertEqual(waitFor(element("taskTitle"), "task detail").label, title)
        let tab1 = waitFor(element("tab-tab-1"), "tab-1")
        XCTAssertTrue(tab1.label.contains(","), "the tab carries its state word: \(tab1.label)")
        waitFor(element("terminal"), "terminal")
        Thread.sleep(forTimeInterval: 6)
        shot("03-detail")

        // S14/S12: find in scrollback, then the tools menu.
        element("terminalTools").tap()
        waitFor(app.buttons["Find in scrollback"].firstMatch, "find item").tap()
        let search = waitFor(element("searchField"), "search field")
        search.typeText("claude")
        shot("04-search")
        hideKeyboard()

        // S15: reset asks first.
        app.buttons["×"].firstMatch.tap()
        element("terminalTools").tap()
        app.buttons["Reset terminal…"].firstMatch.tap()
        waitFor(app.buttons["Reset terminal"].firstMatch, "reset confirmation")
        shot("05-reset-confirm")
        app.buttons["Reset terminal"].firstMatch.tap()

        // S17: a two-line reply is one paste.
        let composer = waitFor(element("composerField"), "composer")
        composer.tap()
        composer.typeText("first line")
        element("newlineButton").tap()
        composer.typeText("second line")
        shot("06-multiline")
        hideKeyboard()

        // S20: interrupt.
        element("key-Esc").swipeLeft()
        element("key-interrupt").tap()
        waitFor(element("terminalFlash"), "interrupt feedback", timeout: 8)
        shot("07-interrupt")

        // S7: rename.
        element("moreMenu").tap()
        waitFor(app.buttons["Rename tab"].firstMatch, "rename item").tap()
        let rename = waitFor(element("renameField"), "rename field")
        rename.tap()
        rename.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 30) + "scratch run")
        shot("08-rename")
        hideKeyboard()
        app.buttons["rename"].firstMatch.tap()
        waitFor(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'scratch run'")).firstMatch, "renamed tab")

        // S2-S5: the new-session sheet.
        element("moreMenu").tap()
        app.buttons["Fork a child task…"].firstMatch.tap()
        waitFor(element("startSessionButton"), "new session sheet")
        app.buttons["3"].firstMatch.tap()
        shot("09-new-session-fork")
        app.buttons["continue this one"].firstMatch.tap()
        Thread.sleep(forTimeInterval: 2)
        shot("10-new-session-continue")
        element("sheetClose").tap()

        // C10: the PR request asks before it sends.
        element("moreMenu").tap()
        app.buttons["Ask the engine for a PR…"].firstMatch.tap()
        waitFor(app.buttons["Send PR request"].firstMatch, "PR confirmation")
        shot("11-pr-confirm")
    }

    /// I8: a `rove api notify` fired from outside shows as a toast. ROVE_NOTIFY_WAIT = seconds to wait.
    func testNoticeToast() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty, let wait = env["ROVE_NOTIFY_WAIT"].flatMap(TimeInterval.init) else {
            throw XCTSkip("ROVE_BRIDGE_URL / ROVE_NOTIFY_WAIT not set")
        }
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
        waitFor(element("noticeToast"), "notify toast", timeout: wait)
        shot("12-toast")
    }
}
