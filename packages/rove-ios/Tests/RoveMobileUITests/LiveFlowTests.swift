import XCTest

/// End-to-end smoke against a real rove-bridge. Skipped unless ROVE_BRIDGE_URL is set
/// (pass with TEST_RUNNER_ROVE_BRIDGE_URL, TEST_RUNNER_ROVE_DEMO_REPO, TEST_RUNNER_ROVE_SHOT_DIR).
/// Screenshots go through scripts/shot-watcher.sh (`simctl io booted screenshot`) via .ready/.done files.
final class LiveFlowTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

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

    private func hideKeyboard() {
        let done = element("keyboardDone")
        if done.waitForExistence(timeout: 3) { done.tap() }
        Thread.sleep(forTimeInterval: 0.6)
    }

    private func text(_ s: String) -> XCUIElement { app.staticTexts[s].firstMatch }

    /// Launches unpaired and answers the first-run notification prompt, which would cover the pairing screen.
    private func launchFresh() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
    }

    func testLiveFlow() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty else { throw XCTSkip("ROVE_BRIDGE_URL not set") }
        let title = "Add a multiply helper"

        launchFresh()

        // Pair
        let field = waitFor(element("pairingField"), "pairing field")
        field.tap()
        field.typeText(url)
        hideKeyboard()
        checkpoint("01-pair")
        element("connectButton").tap()

        // Task list
        waitFor(element("newTaskButton"), "task list")
        waitFor(text("Add a subtract helper"), "existing task row", timeout: 30)
        checkpoint("02-task-list")

        // New task
        element("newTaskButton").tap()
        // Engines are mono tiles once engines.list returns.
        waitFor(app.buttons["codex"].firstMatch, "codex engine tile", timeout: 20).tap()
        let titleField = element("titleField"); titleField.tap(); titleField.typeText(title)
        let prompt = element("promptEditor"); prompt.tap()
        prompt.typeText("Add a multiply(a, b) function to math.ts. Keep it tiny; do not commit.")
        hideKeyboard()
        checkpoint("03-new-task")
        element("createButton").tap()

        // Detail: the first engine tab's terminal opens with it.
        let heading = waitFor(element("taskTitle"), "task detail", timeout: 30)
        XCTAssertEqual(heading.label, title)
        waitFor(element("tab-tab-1"), "tab-1", timeout: 30)
        checkpoint("04-task-detail")

        // Terminal
        waitFor(element("terminal"), "terminal view")
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline, terminalBytes() <= 300 { Thread.sleep(forTimeInterval: 0.5) }
        XCTAssertGreaterThan(terminalBytes(), 300, "terminal produced no output")
        Thread.sleep(forTimeInterval: 8) // let the engine render
        checkpoint("05-terminal")

        let composer = waitFor(element("composerField"), "composer")
        composer.tap()
        composer.typeText("Also add a one-line comment above multiply.")
        element("sendButton").tap()
        hideKeyboard()
        Thread.sleep(forTimeInterval: 20)
        checkpoint("06-terminal-replied")

        // Diff
        waitFor(element("diffLink"), "diff link").tap()
        let file = waitFor(text("math.ts"), "math.ts in diff files", timeout: 30)
        checkpoint("07-diff-files")
        file.tap()
        waitFor(app.navigationBars["math.ts"], "diff file")
        Thread.sleep(forTimeInterval: 1.5)
        checkpoint("08-diff-file")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        waitFor(element("backButton"), "back to detail").tap()

        // Delete
        waitFor(element("moreMenu"), "more menu").tap()
        waitFor(app.buttons["Delete task"].firstMatch, "delete in menu").tap()
        waitFor(app.buttons["Delete…"].firstMatch, "delete confirmation").tap()
        let force = waitFor(element("forceToggle"), "force toggle")
        force.switches.firstMatch.exists ? force.switches.firstMatch.tap() : force.tap()
        checkpoint("09-delete-confirm")
        element("confirmDeleteButton").tap()

        waitFor(element("newTaskButton"), "task list after delete")
        let gone = NSPredicate(format: "exists == false")
        let exp = expectation(for: gone, evaluatedWith: text(title))
        wait(for: [exp], timeout: 30)
        checkpoint("10-deleted")
    }

    /// Bytes the terminal has received, exposed as its accessibility value.
    private func terminalBytes() -> Int {
        Int(element("terminal").value as? String ?? "") ?? 0
    }

    /// Types into an already-running task's terminal from the phone, then uses the accessory key row.
    /// Needs ROVE_BRIDGE_URL and ROVE_TASK_TITLE (optional ROVE_REPLY, ROVE_SHOT_DIR).
    func testTypeIntoExistingTask() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty,
              let taskTitle = env["ROVE_TASK_TITLE"], !taskTitle.isEmpty else {
            throw XCTSkip("ROVE_BRIDGE_URL / ROVE_TASK_TITLE not set")
        }
        let reply = env["ROVE_REPLY"] ?? "From the phone: reply with the word PONG only."

        launchFresh()

        let field = waitFor(element("pairingField"), "pairing field")
        field.tap()
        field.typeText(url)
        hideKeyboard()
        element("connectButton").tap()

        waitFor(element("newTaskButton"), "task list")
        waitFor(text(taskTitle), "task \(taskTitle)", timeout: 30).tap()
        waitFor(element("taskTitle"), "task detail", timeout: 20)

        // The first engine tab's terminal opens with the task.
        waitFor(element("terminal"), "terminal view")
        let start = Date().addingTimeInterval(30)
        while Date() < start, terminalBytes() < 300 { Thread.sleep(forTimeInterval: 0.5) }
        let before = terminalBytes()
        XCTAssertGreaterThan(before, 300, "terminal produced no output")

        let composer = waitFor(element("composerField"), "composer")
        composer.tap()
        composer.typeText(reply)
        element("sendButton").tap()
        hideKeyboard()

        // Wait for the engine's response: bytes keep growing, up to ~25s.
        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline, terminalBytes() <= before + 200 { Thread.sleep(forTimeInterval: 0.5) }
        Thread.sleep(forTimeInterval: 3)
        XCTAssertGreaterThan(terminalBytes(), before, "no response after sending")
        checkpoint("11-phone-typed")

        // The key row is permanently visible; Esc is one tap.
        let esc = waitFor(element("key-Esc"), "Esc key", timeout: 10)
        esc.tap()
        Thread.sleep(forTimeInterval: 2)
        checkpoint("12-phone-keys")
    }

    /// Screenshot-only: Cloudflare preset with fake credentials. Needs ROVE_SHOT_DIR; never connects.
    func testCloudflarePresetScreenshot() throws {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { throw XCTSkip("ROVE_SHOT_DIR not set") }
        launchFresh()

        let field = waitFor(element("pairingField"), "pairing field")
        field.tap()
        field.typeText("wss://rove.example.com/?token=FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK&preset=cf")
        hideKeyboard()
        let id = waitFor(element("cfClientId"), "CF client id field (preset auto-selected from URL)")
        id.tap(); id.typeText("0123abcd.access")
        hideKeyboard()
        let secret = waitFor(element("cfClientSecret"), "CF secret field")
        secret.tap(); secret.typeText("fake-secret-value")
        hideKeyboard()
        checkpoint("13-cloudflare-preset")
    }

    /// Screenshot-only: the task list and one task's detail with its live terminal.
    /// Needs ROVE_BRIDGE_URL, ROVE_TASK_TITLE and ROVE_SHOT_DIR; changes nothing on the Mac.
    func testTaskScreensScreenshots() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty,
              let taskTitle = env["ROVE_TASK_TITLE"], !taskTitle.isEmpty,
              env["ROVE_SHOT_DIR"]?.isEmpty == false else {
            throw XCTSkip("ROVE_BRIDGE_URL / ROVE_TASK_TITLE / ROVE_SHOT_DIR not set")
        }
        launchFresh()

        let field = waitFor(element("pairingField"), "pairing field")
        field.tap()
        field.typeText(url)
        hideKeyboard()
        element("connectButton").tap()

        waitFor(element("newTaskButton"), "task list")
        let row = waitFor(text(taskTitle), "task \(taskTitle)", timeout: 30)
        Thread.sleep(forTimeInterval: 2)
        checkpoint("design-list")

        row.tap()
        waitFor(element("taskTitle"), "task detail", timeout: 20)
        let terminal = waitFor(element("terminal"), "terminal")
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, (Int(terminal.value as? String ?? "") ?? 0) < 300 { Thread.sleep(forTimeInterval: 0.5) }
        Thread.sleep(forTimeInterval: 4)
        checkpoint("design-detail")

        // The activity timer ages locally between pushes; it must not sit still.
        let timer = element("activityTimer")
        if timer.exists {
            let before = timer.label
            Thread.sleep(forTimeInterval: 2.5)
            XCTAssertNotEqual(timer.label, before, "activity timer did not advance")
        }
    }
}
