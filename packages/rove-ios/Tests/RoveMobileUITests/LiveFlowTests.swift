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

    func testLiveFlow() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty else { throw XCTSkip("ROVE_BRIDGE_URL not set") }
        let title = "Add a multiply helper"

        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()

        // Pair
        let field = waitFor(element("pairingField"), "pairing field")
        field.tap()
        field.typeText(url)
        hideKeyboard()
        checkpoint("01-pair")
        element("connectButton").tap()

        // Task list
        waitFor(app.navigationBars["Tasks"], "task list")
        waitFor(text("Add a subtract helper"), "existing task row", timeout: 30)
        checkpoint("02-task-list")

        // New task
        element("newTaskButton").tap()
        // The picker shows the first engine once engines.list returns; tap that menu button.
        let current = waitFor(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Claude'")).firstMatch, "engine menu", timeout: 20)
        current.tap()
        waitFor(app.buttons["Codex"].firstMatch, "Codex option").tap()
        let titleField = element("titleField"); titleField.tap(); titleField.typeText(title)
        let prompt = element("promptEditor"); prompt.tap()
        prompt.typeText("Add a multiply(a, b) function to math.ts. Keep it tiny; do not commit.")
        hideKeyboard()
        checkpoint("03-new-task")
        element("createButton").tap()

        // Detail
        waitFor(app.navigationBars[title], "task detail", timeout: 30)
        let tab = waitFor(element("tab-tab-1"), "tab-1 row", timeout: 30)
        checkpoint("04-task-detail")

        // Terminal
        tab.tap()
        let bytes = waitFor(element("terminalStatus"), "terminal view")
        var seen = 0
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            let label = bytes.label // "Live · 1234 B"
            seen = Int((label.components(separatedBy: " · ").last ?? "").filter(\.isNumber)) ?? 0
            if seen > 300 { break }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertGreaterThan(seen, 300, "terminal produced no output")
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
        app.navigationBars.buttons.element(boundBy: 0).tap()
        waitFor(element("diffLink"), "diff link").tap()
        let file = waitFor(text("math.ts"), "math.ts in diff files", timeout: 30)
        checkpoint("07-diff-files")
        file.tap()
        waitFor(app.navigationBars["math.ts"], "diff file")
        Thread.sleep(forTimeInterval: 1.5)
        checkpoint("08-diff-file")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // Delete
        waitFor(element("deleteButton"), "delete button").tap()
        waitFor(app.buttons["Delete…"].firstMatch, "delete confirmation").tap()
        let force = waitFor(element("forceToggle"), "force toggle")
        force.switches.firstMatch.exists ? force.switches.firstMatch.tap() : force.tap()
        checkpoint("09-delete-confirm")
        element("confirmDeleteButton").tap()

        waitFor(app.navigationBars["Tasks"], "task list after delete")
        let gone = NSPredicate(format: "exists == false")
        let exp = expectation(for: gone, evaluatedWith: text(title))
        wait(for: [exp], timeout: 30)
        checkpoint("10-deleted")
    }

    private func terminalBytes() -> Int {
        let label = element("terminalStatus").label // "Live · 1,234 B"
        return Int((label.components(separatedBy: " · ").last ?? "").filter(\.isNumber)) ?? 0
    }

    /// Types into an already-running task's terminal from the phone, then uses the accessory key row.
    /// Needs ROVE_BRIDGE_URL and ROVE_TASK_TITLE (optional ROVE_REPLY, ROVE_SHOT_DIR).
    func testTypeIntoExistingTask() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty,
              let taskTitle = env["ROVE_TASK_TITLE"], !taskTitle.isEmpty else {
            throw XCTSkip("ROVE_BRIDGE_URL / ROVE_TASK_TITLE not set")
        }
        let reply = env["ROVE_REPLY"] ?? "From the phone: reply with the word PONG only."

        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()

        let field = waitFor(element("pairingField"), "pairing field")
        field.tap()
        field.typeText(url)
        hideKeyboard()
        element("connectButton").tap()

        waitFor(app.navigationBars["Tasks"], "task list")
        waitFor(text(taskTitle), "task \(taskTitle)", timeout: 30).tap()
        waitFor(app.navigationBars[taskTitle], "task detail", timeout: 20)

        // First engine tab = first tab row.
        let tab = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'tab-'")).firstMatch
        waitFor(tab, "first tab row", timeout: 20).tap()

        waitFor(element("terminalStatus"), "terminal view")
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
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()

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
}
