import XCTest

/// Files area against a real bridge: skipped unless ROVE_BRIDGE_URL and ROVE_FILES_TASK are set
/// (TEST_RUNNER_ prefixed). ROVE_SHOT_DIR receives a PNG per step.
final class FilesFlowTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    private func el(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func shot(_ name: String) {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { return }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        Thread.sleep(forTimeInterval: 0.6)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
    }

    @discardableResult
    private func wait(_ e: XCUIElement, _ what: String, _ t: TimeInterval = 20) -> XCUIElement {
        XCTAssertTrue(e.waitForExistence(timeout: t), "timed out waiting for \(what)")
        return e
    }

    private func open(_ path: String) {
        let row = el("file-\(path)")
        wait(row, path).tap()
    }

    func testFilesFlow() throws {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty, let task = env["ROVE_FILES_TASK"] else { throw XCTSkip("not configured") }
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let field = wait(el("pairingField"), "pairing field")
        field.tap(); field.typeText(url)
        let done = el("keyboardDone"); if done.waitForExistence(timeout: 3) { done.tap() }
        el("connectButton").tap()
        wait(el("newTaskButton"), "task list")
        wait(el("task-\(task)"), "task row", 30).tap()
        wait(el("diffLink"), "diff link").tap()

        // Changes: scope header, combined row, groups
        wait(el("combinedAll"), "combined row")
        shot("01-changes-working")
        // single-file states
        open("src/refunds.ts"); wait(el("diffLine-8"), "diff rows"); shot("02-rename-diff")
        // select a range and drop a note
        el("diffLine-9").tap(); el("diffLine-10").tap()
        wait(el("addNote"), "note button"); shot("03-selection")
        el("addNote").tap()
        let editor = wait(app.textViews.firstMatch, "note editor"); editor.tap(); editor.typeText("rename this export")
        let kd = el("keyboardDone"); if kd.waitForExistence(timeout: 2) { kd.tap() }
        shot("04-composer")
        el("dropNote").tap()
        wait(el("notesButton"), "notes button"); shot("05-note-in-diff")
        el("backButton").tap()
        open("src/charge.ts"); wait(app.staticTexts["mode changed"], "mode state"); shot("06-mode-only")
        el("backButton").tap()
        open("src/empty.txt"); wait(app.staticTexts["empty file added"], "empty state"); shot("07-empty-file")
        el("backButton").tap()
        open("assets.png"); wait(app.staticTexts["image"], "image state"); shot("08-binary")
        el("backButton").tap()
        el("combinedAll").tap(); wait(el("diffLine-5"), "combined diff"); shot("09-combined-all")
        el("backButton").tap()
        // All tab: browse, preview
        app.buttons["all"].firstMatch.tap()
        wait(el("dir-docs/"), "tree"); shot("10-all-tree")
        el("dir-docs/").tap()
        wait(el("tree-docs/guide.md"), "guide"); el("tree-docs/guide.md").tap()
        wait(el("diffLine-0"), "guide diff"); shot("11-preview-diff")
        el("backButton").tap()
        shot("12-all-in-dir")
        el("notesButton").tap()
        wait(el("sendNotes"), "notes sheet"); shot("13-notes-sheet")
        el("sendNotes").tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Send '")).firstMatch.tap()
        wait(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'sent ' OR label BEGINSWITH 'not delivered'")).firstMatch, "send result", 40)
        shot("14-sent")
    }

    private func launchToFiles(task override: String? = nil) {
        guard let url = env["ROVE_BRIDGE_URL"], !url.isEmpty, let task = override ?? env["ROVE_FILES_TASK"] else { return }
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let field = wait(el("pairingField"), "pairing field")
        field.tap(); field.typeText(url)
        let done = el("keyboardDone"); if done.waitForExistence(timeout: 3) { done.tap() }
        el("connectButton").tap()
        wait(el("task-\(task)"), "task row", 30).tap()
        wait(el("diffLink"), "diff link").tap()
    }

    func testMentionLandsInEngineInput() throws {
        guard env["ROVE_FILES_TASK"] != nil else { throw XCTSkip("not configured") }
        launchToFiles()
        app.buttons["all"].firstMatch.tap()
        wait(el("tree-README.md"), "README").tap()
        wait(el("mentionButton"), "mention").tap()
        Thread.sleep(forTimeInterval: 2); shot("19-after-mention-tap")
        wait(el("taskTitle"), "back on task detail")
        Thread.sleep(forTimeInterval: 6)
        shot("20-mention-in-input")
    }

    func testWorktreesPage() throws {
        guard env["ROVE_FILES_TASK"] != nil else { throw XCTSkip("not configured") }
        launchToFiles()
        el("backButton").tap(); el("backButton").tap()
        wait(el("pagesMenu"), "pages menu").tap()
        app.buttons["worktrees"].firstMatch.tap()
        wait(el("worktree-/private/tmp/rove-ios-par/wt-demo"), "ad-hoc row", 40)
        shot("30-worktrees")
        el("worktree-/private/tmp/rove-ios-par/wt-demo").tap()
        wait(el("removeWorktree"), "action sheet"); shot("31-worktree-sheet")
        el("removeWorktree").tap()
        app.buttons["Remove worktree"].firstMatch.tap()
        // dirty: second explicit confirm quotes the reason
        let force = app.buttons["Force remove — discard changes"].firstMatch
        wait(force, "force confirm"); shot("32-force-confirm")
        force.tap()
        wait(el("worktreeNotice"), "removed notice", 30); shot("33-removed")
    }

    /// F7/F3: a git failure is shown as git said it, and `retry` recovers once the cause is gone.
    func testGitErrorShownVerbatimThenRetryRecovers() throws {
        guard let task = env["ROVE_ERR_TASK"], let dir = env["ROVE_ERR_DIR"] else { throw XCTSkip("not configured") }
        let fm = FileManager.default
        try fm.moveItem(atPath: dir, toPath: dir + ".gone")
        defer { if fm.fileExists(atPath: dir + ".gone") { try? fm.moveItem(atPath: dir + ".gone", toPath: dir) } }
        var tmp = env; tmp["ROVE_FILES_TASK"] = task
        launchToFiles(task: task)
        let err = wait(el("filesError"), "git error line", 30)
        XCTAssertTrue(err.label.contains("git") || err.label.contains("worktree") || err.label.contains("No such"), "got: \(err.label)")
        shot("40-git-error")
        try fm.moveItem(atPath: dir + ".gone", toPath: dir)
        el("retryButton").tap()
        wait(el("combinedAll").exists ? el("combinedAll") : app.staticTexts["no changes"], "recovered", 30)
        shot("41-recovered")
    }
}
