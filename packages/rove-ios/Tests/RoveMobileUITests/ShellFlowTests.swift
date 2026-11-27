import XCTest

/// The web shell against a real `rove --web`. Skipped unless ROVE_WEB_LINK is set (pass TEST_RUNNER_ROVE_WEB_LINK,
/// TEST_RUNNER_ROVE_WEB_TASK = a task title on that bridge, TEST_RUNNER_ROVE_SHOT_DIR for scripts/shot-watcher.sh).
final class ShellFlowTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    private func checkpoint(_ name: String) {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { return }
        let done = (dir as NSString).appendingPathComponent(name + ".done")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: (dir as NSString).appendingPathComponent(name + ".ready"), contents: Data())
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, !FileManager.default.fileExists(atPath: done) { Thread.sleep(forTimeInterval: 0.2) }
    }

    func testPasteLinkOpensRoveWeb() throws {
        guard let link = env["ROVE_WEB_LINK"], !link.isEmpty else { throw XCTSkip("ROVE_WEB_LINK not set") }
        let task = env["ROVE_WEB_TASK"] ?? "Repo purpose overview"
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()

        let field = app.descendants(matching: .any)["pairingField"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        checkpoint("01-pairing")
        field.tap()
        field.typeText(link)
        app.descendants(matching: .any)["connectButton"].firstMatch.tap()

        let row = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label ENDSWITH %@", task)).firstMatch
        if !row.waitForExistence(timeout: 30) {
            checkpoint("02-failed")
            print(app.debugDescription)
            XCTFail("rove-web's session list")
        }
        Thread.sleep(forTimeInterval: 1)
        checkpoint("02-sessions")

        row.tap()
        Thread.sleep(forTimeInterval: 4)
        checkpoint("03-terminal")

        // Hold-to-talk: WebKit asks for the mic, then iOS shows its own prompt.
        let mic = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH[c] 'Hold to talk'")).firstMatch
        guard mic.waitForExistence(timeout: 5) else { return print(app.debugDescription) }
        mic.press(forDuration: 2.5)
        checkpoint("04-mic")
        mic.tap()
        Thread.sleep(forTimeInterval: 1.5)
        checkpoint("05-keyboard")
    }

    /// A computer that doesn't answer shows the native failure screen, whose computer list pairs another.
    func testUnreachableComputerOffersTheList() {
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing", "-pairLink", "http://127.0.0.1:5562/#token=x"]
        app.launch()
        let computers = app.buttons["computersButton"]
        XCTAssertTrue(computers.waitForExistence(timeout: 20))
        checkpoint("06-unreachable")
        computers.tap()
        XCTAssertTrue(app.staticTexts["127.0.0.1:5562"].waitForExistence(timeout: 5))
        checkpoint("07-computers")
        app.buttons["pairAnotherButton"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["pairingField"].waitForExistence(timeout: 5))
    }
}
