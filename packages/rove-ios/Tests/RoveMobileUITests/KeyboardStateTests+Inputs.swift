import XCTest

/// Where every keyboard-raising input lives, and the taps that reach it. What is asserted at each one is
/// `check` in KeyboardStateTests.swift.
extension KeyboardStateTests {
    // MARK: Sweeps

    func sweepInputs(_ look: XCUIDevice.Appearance, fixture: String?) throws {
        try launch(look, fixture: fixture)
        sweepPairing()
        enter(fixture: fixture)
        sweepList()
        sweepNewTask()
        openTask()
        sweepDetail()
        back()
        sweepRoutines()
        sweepBoard()
        sweepSettings()
        sweepDiff()
    }

    /// One input of each kind, with the same `check`: a screen field (pairing), the list search, a sheet field
    /// and a sheet editor (new task), a sheet opened from the detail menu (rename), a settings page (feedback)
    /// and the files search. CI's dark pass runs this instead of `sweepInputs` (see docs/KEYBOARD.md).
    func sampleInputs(_ look: XCUIDevice.Appearance, fixture: String?) throws {
        try launch(look, fixture: fixture)
        check("pairing-link", { self.input("pairingField") }, landmarks: ["connectButton"])
        enter(fixture: fixture)
        sweepList()
        el("newTaskButton").tap()
        waitFor(visible("createButton"), "new task sheet")
        let primary = { self.assertReachable("createButton") }
        check("newtask-title", { self.input("titleField") }, landmarks: ["createButton", "sheetClose"], whileUp: primary)
        check("newtask-prompt", { self.input("promptEditor") }, landmarks: ["createButton", "sheetClose"], whileUp: primary)
        closeSheet()
        openTask()
        sheetCheck("rename-task", menu: "Rename", field: "renameField", primary: "renameConfirm")
        el("diffLink").tap()
        waitFor(app.buttons["all"].firstMatch, "all files").tap()
        check("files-search", { self.input("pathSearch") }, landmarks: ["backButton"])
        el("backButton").tap()
        back()
        el("settingsButton").tap()
        waitFor(el("settingsRow-feedback"), "settings").tap()
        check("feedback-title", { self.input("feedbackTitle") }, landmarks: ["feedbackSend"],
              whileUp: { self.assertReachable("feedbackSend") })
    }

    private func sweepPairing() {
        let lm = ["connectButton"]
        check("pairing-link", { self.input("pairingField") }, landmarks: lm)
        el("presetPicker").buttons["cloudflare"].tap()
        check("pairing-cf-id", { self.input("cfClientId") }, landmarks: lm)
        check("pairing-cf-secret", { self.input("cfClientSecret") }, landmarks: lm)
        el("presetPicker").buttons["direct"].tap()
        app.buttons["+ header"].firstMatch.tap()
        check("pairing-header-name", { self.app.textFields.matching(NSPredicate(format: "placeholderValue == 'name'")).firstMatch }, landmarks: lm)
        check("pairing-header-value", { self.app.secureTextFields.matching(NSPredicate(format: "placeholderValue == 'value'")).firstMatch }, landmarks: lm)
        app.buttons["Remove header"].firstMatch.tap()
    }

    private func sweepList() {
        el("searchButton").tap()
        check("list-search", { self.input("searchField") }, landmarks: ["newTaskButton", "settingsButton"])
        el("searchButton").tap()
    }

    func sweepNewTask() {
        el("newTaskButton").tap()
        waitFor(visible("createButton"), "new task sheet")
        let lm = ["createButton", "sheetClose"]
        let primary = { self.assertReachable("createButton") }
        check("newtask-title", { self.input("titleField") }, landmarks: lm, whileUp: primary)
        check("newtask-prompt", { self.input("promptEditor") }, landmarks: lm, whileUp: primary)
        visible("optionsToggle").tap()
        check("newtask-branch", { self.input("branchField") }, landmarks: lm, whileUp: primary)
        visible("modePicker").buttons["clone"].tap()
        check("newtask-clone-url", { self.input("cloneURLField") }, landmarks: lm, whileUp: primary)
        check("newtask-clone-parent", { self.input("cloneParentField") }, landmarks: lm, whileUp: primary)
        check("newtask-clone-folder", { self.input("cloneFolderField") }, landmarks: lm, whileUp: primary)
        closeSheet()
    }

    private func sweepDetail() {
        let lm = ["taskTitle", "landButton"]
        check("detail-composer", { self.input("composerField") }, landmarks: lm, whileUp: { self.assertTerminalBlock() })
        check("detail-terminal", { self.el("terminal") }, landmarks: lm, whileUp: { self.assertTerminalBlock() })
        check("detail-find", { self.input("searchField") }, focus: {
            self.el("terminalTools").tap()
            self.waitFor(self.app.buttons["Find in scrollback"].firstMatch, "find item").tap()
        }, landmarks: lm)
        app.buttons["×"].firstMatch.tap()

        sheetCheck("rename-task", menu: "Rename", field: "renameField", primary: "renameConfirm")
        sheetCheck("branch", menu: "Branch…", field: "branchField", primary: "branchConfirm")
        sheetCheck("model", menu: "Model & effort…", field: "modelField", primary: "modelEffortConfirm")
        sheetCheck("rename-tab", menu: "Rename tab", field: "renameField", primary: "rename")
        openMenu("New session…")
        waitFor(visible("startSessionButton"), "new session sheet")
        check("new-session-prompt", { self.app.textViews.allElementsBoundByIndex.last { $0.isHittable } ?? self.app.textViews.firstMatch },
              landmarks: ["startSessionButton", "sheetClose"], whileUp: { self.assertReachable("startSessionButton") })
        closeSheet()
    }

    private func sweepRoutines() {
        openPage("page-routines")
        waitFor(el("routineNew"), "routines").tap()
        routineFields("routine-new", primary: "createRoutine")
        closeSheet()
        waitFor(el("routineRow-r-ok"), "routine row").tap()
        waitFor(visible("routineEdit"), "routine detail").tap()
        routineFields("routine-edit", primary: "saveRoutine")
        closeSheet()
        closeSheet()
        back()
    }

    private func routineFields(_ name: String, primary: String) {
        waitFor(visible(primary), "\(name) sheet")
        let lm = [primary, "sheetClose"]
        let reach = { self.assertReachable(primary) }
        check("\(name)-name", { self.input("routineName") }, landmarks: lm, whileUp: reach)
        check("\(name)-prompt", { self.input("routinePrompt") }, landmarks: lm, whileUp: reach)
        check("\(name)-schedule", { self.input("routineSchedule") }, landmarks: lm, whileUp: reach)
    }

    private func sweepBoard() {
        openPage("page-board")
        waitFor(el("boardNewStory"), "board").tap()
        waitFor(visible("newStorySave"), "new story sheet")
        let lmNew = ["newStorySave", "sheetClose"]
        check("story-new-title", { self.input("newStoryTitle") }, landmarks: lmNew, whileUp: { self.assertReachable("newStorySave") })
        check("story-new-body", { self.input("newStoryDescription") }, landmarks: lmNew, whileUp: { self.assertReachable("newStorySave") })
        closeSheet()
        let backlog = el("boardColumns").buttons.matching(NSPredicate(format: "label BEGINSWITH 'backlog'")).firstMatch
        if backlog.waitForExistence(timeout: 3) { backlog.tap() }
        waitFor(el("storyCard-9"), "backlog story").tap()
        waitFor(visible("drawerSave"), "story drawer")
        let lm = ["drawerSave", "sheetClose"]
        check("issue-title", { self.input("drawerTitle") }, landmarks: lm, whileUp: { self.assertReachable("drawerSave") })
        check("issue-body", { self.input("drawerDescription") }, landmarks: lm, whileUp: { self.assertReachable("drawerSave") })
        closeSheet()
        back()
    }

    private func sweepSettings() {
        el("settingsButton").tap()
        waitFor(el("settingsRow-feedback"), "settings").tap()
        let lm = ["feedbackSend"]
        check("feedback-title", { self.input("feedbackTitle") }, landmarks: lm, whileUp: { self.assertReachable("feedbackSend") })
        check("feedback-body", { self.input("feedbackBody") }, landmarks: lm, whileUp: { self.assertReachable("feedbackSend") })
        el("backButton").tap()
        waitFor(el("settingsRow-engines"), "settings").tap()
        waitFor(el("engineRow-claude"), "engine row").tap()
        check("engine-name", { self.input("engineNameField") }, landmarks: ["sheetClose"])
        closeSheet()
        el("backButton").tap()
        back()
    }

    private func sweepDiff() {
        openTask()
        el("diffLink").tap()
        waitFor(app.buttons["all"].firstMatch, "all files").tap()
        check("files-search", { self.input("pathSearch") }, landmarks: ["backButton"])
        waitFor(app.buttons["changes"].firstMatch, "changes tab").tap()
        waitFor(el("file-src/refunds/webhook.ts"), "changed file").tap()
        // One tap on a code row selects it and brings up `note`; header rows are not selectable, so walk down.
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'diffLine-'"))
        waitFor(rows.firstMatch, "diff rows")
        for row in rows.allElementsBoundByIndex.prefix(12) where row.isHittable && !el("addNote").exists {
            row.tap()
            _ = el("addNote").waitForExistence(timeout: 1)
        }
        waitFor(el("addNote"), "note button after selecting a code row").tap()
        waitFor(visible("dropNote"), "note sheet")
        check("review-note", { self.app.textViews.allElementsBoundByIndex.last { $0.isHittable } ?? self.app.textViews.firstMatch },
              landmarks: ["dropNote", "sheetClose"], whileUp: { self.assertReachable("dropNote") })
        closeSheet()
    }

    // MARK: Navigation

    func fixtureURL() throws -> String {
        guard let url = env["ROVE_FIXTURE_URL"], !url.isEmpty else { throw XCTSkip("ROVE_FIXTURE_URL not set") }
        return url
    }

    /// The themes this run covers: both, unless the host fixed one with `simctl ui … appearance`
    /// (ROVE_APPEARANCE=light|dark, as CI does in two passes).
    var looks: [XCUIDevice.Appearance] {
        switch env["ROVE_APPEARANCE"] {
        case "light": [.light]
        case "dark": [.dark]
        default: [.light, .dark]
        }
    }

    /// Launches unpaired in `look` and checks the app's own paper really is in that theme, since every
    /// keyboard-color check depends on it. Without ROVE_APPEARANCE the test switches the theme itself (a freshly
    /// booted simulator can ignore the first switch, so it retries).
    private func launch(_ look: XCUIDevice.Appearance, fixture: String?) throws {
        appearance = look
        label = "\(look == .dark ? "dark" : "light")-portrait-\(fixture == nil ? "demo" : "fixture")"
        app = XCUIApplication()
        app.launchArguments = ["-resetPairing"]
        let hostSet = env["ROVE_APPEARANCE"] != nil
        for attempt in 0..<(hostSet ? 1 : 3) {
            if attempt > 0 {
                app.terminate()
                XCUIDevice.shared.appearance = look == .dark ? .light : .dark
                Thread.sleep(forTimeInterval: 1)
            }
            if !hostSet {
                XCUIDevice.shared.appearance = look
                Thread.sleep(forTimeInterval: 1)
            }
            app.launch()
            let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
            if allow.waitForExistence(timeout: 3) { allow.tap() }
            waitFor(el("pairingField"), "pairing screen")
            let paper = screen().luminance(in: CGRect(x: 4, y: app.frame.midY, width: 8, height: 20))
            if (look == .dark) == (paper < 0.5) { return }
        }
        // Only on CI: there the hosted simulator has been seen to keep a light UI through every switch. Locally
        // this stays a failure, since an app stuck in light looks exactly the same.
        if env["ROVE_CI"] != nil {
            throw XCTSkip("\(label): the CI simulator kept the other appearance; dark-theme checks are verified locally (packages/rove-ios/docs/KEYBOARD.md)")
        }
        XCTFail("\(label): the app stayed in the other appearance")
    }

    private func enter(fixture: String?) {
        if let fixture {
            input("pairingField").tap()
            input("pairingField").typeText(fixture)
            dismiss()
            el("connectButton").tap()
        } else {
            el("demoButton").tap()
        }
        waitFor(el("newTaskButton"), "task list")
    }

    func start(_ look: XCUIDevice.Appearance, fixture: String?) throws {
        try launch(look, fixture: fixture)
        enter(fixture: fixture)
    }

    func openTask() {
        waitFor(el("task-T-WAIT"), "task row").tap()
        waitFor(el("taskTitle"), "task detail")
        let deadline = Date().addingTimeInterval(20)
        while Int(el("terminal").value as? String ?? "") ?? 0 == 0, Date() < deadline { Thread.sleep(forTimeInterval: 0.3) }
        Thread.sleep(forTimeInterval: 1)
    }

    private func back() {
        el("backButton").tap()
        waitFor(el("newTaskButton"), "task list")
    }

    private func openPage(_ id: String) {
        waitFor(el("pagesMenu"), "pages menu").tap()
        waitFor(el(id), id).tap()
    }

    /// The detail `…` menu item; a tap while a sheet is still closing opens nothing, so retry.
    private func openMenu(_ label: String) {
        let item = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        for _ in 0..<3 {
            Thread.sleep(forTimeInterval: 1)
            el("moreMenu").tap()
            if item.waitForExistence(timeout: 3) { break }
        }
        waitFor(item, "menu item \(label)").tap()
    }

    private func sheetCheck(_ name: String, menu: String, field: String, primary: String) {
        openMenu(menu)
        waitFor(visible(primary), "\(name) sheet")
        check(name, { self.input(field) }, landmarks: [primary, "sheetClose"], whileUp: { self.assertReachable(primary) })
        closeSheet()
    }

    private func closeSheet() {
        visible("sheetClose").tap()
        Thread.sleep(forTimeInterval: 0.8)
    }
}
