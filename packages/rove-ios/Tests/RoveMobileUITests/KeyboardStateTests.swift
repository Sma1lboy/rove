import XCTest

/// Keyboard state on every input that raises the software keyboard; packages/rove-ios/docs/KEYBOARD.md
/// is the coverage matrix. Demo tests need nothing. Fixture tests, and every assertion on what the PTY
/// received (resize rows, typed bytes), need scripts/fixture-bridge.ts running and
/// TEST_RUNNER_ROVE_FIXTURE_URL=ws://127.0.0.1:7896/?token=fixture; they skip otherwise.
/// ROVE_SHOT_DIR saves each input with the keyboard up.
final class KeyboardStateTests: XCTestCase {
    let env = ProcessInfo.processInfo.environment
    var app: XCUIApplication!
    var kb: KeyboardProbe { KeyboardProbe(app: app) }
    var appearance = XCUIDevice.Appearance.light
    /// `light-portrait-demo`: prefixes every failure and screenshot.
    var label = ""

    override func setUp() {
        continueAfterFailure = true
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
        if env["ROVE_APPEARANCE"] == nil { XCUIDevice.shared.appearance = .light }
    }

    // MARK: Tests

    // Each theme once and each mode once (the terminal and landscape tests below run every pairing): the
    // reviewer's path (demo) in light, the fixture bridge in dark.
    func testInputsDemoLight() throws { try sweepInputs(.light, fixture: nil) }
    func testInputsFixtureDark() throws { try sweepInputs(.dark, fixture: try fixtureURL()) }

    func testTerminalDemo() throws {
        for look in looks {
            try start(look, fixture: nil)
            openTask()
            terminalChecks(log: nil)
        }
    }

    func testTerminalFixture() throws {
        let url = try fixtureURL()
        for look in looks {
            try start(look, fixture: url)
            openTask()
            terminalChecks(log: FixtureLog(socketURL: url))
        }
    }

    func testLandscapeDemo() throws { try landscape(fixture: nil) }
    func testLandscapeFixture() throws { try landscape(fixture: try fixtureURL()) }

    /// A hardware keyboard: with one attached (Simulator → I/O → Keyboard → Connect Hardware Keyboard, or
    /// `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool true`) no software keyboard
    /// comes up and `typeKey` arrives as key presses. Without one, `typeKey` types through the software
    /// keyboard, which has no ctrl or esc, so the test skips rather than measure the wrong path.
    func testHardwareKeysReachTheTerminal() throws {
        let url = try fixtureURL()
        let log = try XCTUnwrap(FixtureLog(socketURL: url))
        try start(.light, fixture: url)
        openTask()
        let term = el("terminal")
        term.tap()
        Thread.sleep(forTimeInterval: 1.5)
        if kb.isUp {
            throw XCTSkip("no hardware keyboard attached to this simulator: a software keyboard came up (\(kb.keyboard.frame)), and typeKey through it cannot send ctrl or esc")
        }
        XCTAssertTrue(holdsFocus(term), "the terminal takes focus without a software keyboard; focus on \(focusHolder())")
        /// What one hardware key press put on the PTY, alone.
        func sent(_ key: String, _ flags: XCUIElement.KeyModifierFlags) -> String {
            log.clear()
            term.typeKey(key, modifierFlags: flags)
            let deadline = Date().addingTimeInterval(3)
            var got = log.input()
            while got.isEmpty, Date() < deadline { Thread.sleep(forTimeInterval: 0.2); got = log.input() }
            Thread.sleep(forTimeInterval: 0.3)
            return log.input()
        }
        XCTAssertEqual(sent("c", .control), "\u{03}", "ctrl-c")
        // Escape typed by XCUITest reaches no responder in the app on the simulator: SwiftTerm's pressesBegan
        // never sees it, nor does a priority UIKeyCommand for inputEscape. Recorded, not asserted away.
        let esc = sent(XCUIKeyboardKey.escape.rawValue, [])
        XCTExpectFailure("the simulator does not deliver a typed Escape to the app", strict: false) {
            XCTAssertEqual(esc, "\u{1b}", "esc")
        }
        let up = sent(XCUIKeyboardKey.upArrow.rawValue, [])
        XCTAssertTrue(["\u{1b}[A", "\u{1b}OA"].contains(up), "up arrow: \(up.debugDescription)")
        // ⌘B, not ⌘K: Simulator takes ⌘K itself (toggle software keyboard) and never passes it on.
        XCTAssertEqual(sent("b", .command), "", "⌘B is a shortcut, never the letter b")
    }

    // MARK: Terminal

    /// Key row and composer form one bar that sits on the keyboard (≤ 2 pt), and every key and `send` can be hit.
    /// The key row scrolls sideways (most-used first), so a key past a narrow screen's edge is scrolled to.
    func assertTerminalBlock() {
        let px = screen(), top = kb.coveredTop(px)
        let row = el("keyRow").frame, bar = el("composerBar").frame
        XCTAssertLessThanOrEqual(abs(bar.minY - row.maxY), 2, "\(label): key row \(row) not on the composer \(bar)")
        XCTAssertLessThanOrEqual(abs(top - bar.maxY), 2, "\(label): composer bar ends at \(bar.maxY), keyboard at \(top)")
        let rowCenter = el("keyRow").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        /// Back to the row's leading edge (a drag past it just stops there).
        func rewind() {
            rowCenter.press(forDuration: 0.05, thenDragTo: rowCenter.withOffset(CGVector(dx: 400, dy: 0)))
            Thread.sleep(forTimeInterval: 0.5)
        }
        rewind()
        for id in ["key-Esc", "key-Ctrl", "key-↑", "sendButton"] {
            let e = el(id)
            // Keys: the visible part of the row runs from its left edge to its `done` key, less the 32 pt fade. A
            // key past that edge is dragged in by its overflow, then must sit inside it. Judged by frame: XCUI's
            // isHittable throws ("activation point invalid") on keys while the row settles.
            let rowFrame = el("keyRow").frame
            let edge = (kb.done?.frame.minX ?? rowFrame.maxX) - 32
            let overflow = id.hasPrefix("key-") ? e.frame.maxX - edge : 0
            if overflow > 0 {
                rowCenter.press(forDuration: 0.05, thenDragTo: rowCenter.withOffset(CGVector(dx: -(overflow + 40), dy: 0)))
                Thread.sleep(forTimeInterval: 0.5)
            }
            if id.hasPrefix("key-") {
                let f = e.frame
                XCTAssertTrue(f.minX >= rowFrame.minX - 1 && f.maxX <= edge + 1 && f.width > 0,
                              "\(label): \(id) at \(f) is outside the visible key row (\(rowFrame.minX)…\(edge))")
            } else {
                XCTAssertTrue(e.isHittable, "\(label): \(id) not reachable with the keyboard up")
            }
            XCTAssertLessThanOrEqual(e.frame.maxY, top + 0.5, "\(label): \(id) under the keyboard")
            if overflow > 0 { rewind() }
        }
        XCTAssertGreaterThan(el("terminal").frame.height, 40, "\(label): terminal squeezed out")
        let term = el("terminal").frame
        let lum = px.luminance(in: CGRect(x: term.minX + 1, y: term.midY - 10, width: 4, height: 20))
        XCTAssertLessThan(lum, 0.15, "\(label): terminal is espresso in every theme (luminance \(lum))")
    }

    private func terminalChecks(log: FixtureLog?) {
        let term = el("terminal")
        let restFrame = term.frame
        let restSize = log?.lastSize()
        if log != nil { XCTAssertNotNil(restSize, "\(label): attach carried a size") }

        for (name, focus) in [("reply", { self.input("composerField").tap() }), ("terminal", { term.tap() })] {
            focus()
            guard kb.waitUp() else { XCTFail("\(label) \(name): no keyboard"); continue }
            assertTerminalBlock()
            // Landscape typing mode hands the header's height back, so "shorter" is any loss; rows below are the point.
            XCTAssertLessThan(term.frame.height, restFrame.height - 1, "\(label) \(name): terminal did not get shorter")
            if let log, let rest = restSize {
                let up = waitForSize(log) { $0.rows < rest.rows }
                XCTAssertNotNil(up, "\(label) \(name): no term.resize with fewer rows than \(rest.rows)")
                XCTAssertEqual(up?.cols, rest.cols, "\(label) \(name): columns changed with the keyboard")
            }
            shot("terminal-\(name)")
            guard let done = kb.done else { XCTFail("\(label) \(name): no keyboardDone"); dismiss(); continue }
            done.tap()
            XCTAssertTrue(kb.waitDown(), "\(label) \(name): Done left the keyboard up; focus on \(focusHolder())")
            XCTAssertLessThanOrEqual(abs(term.frame.height - restFrame.height), 1, "\(label) \(name): terminal did not grow back")
            if let log, let rest = restSize {
                let back = waitForSize(log) { $0.rows == rest.rows }
                XCTAssertNotNil(back, "\(label) \(name): rows not restored to \(rest.rows)")
            }
        }

        // Typing and keys while the keyboard is up.
        let field = input("composerField")
        field.tap()
        XCTAssertTrue(kb.waitUp())
        log?.clear()
        field.typeText("ship it")
        el("sendButton").tap()
        el("key-Esc").tap()
        XCTAssertTrue(kb.isUp, "\(label): a key-row press dropped the keyboard")
        if let log {
            let sent = waitForInput(log) { $0.contains("ship it\r\u{1b}") || $0.hasSuffix("\u{1b}") }
            XCTAssertTrue(sent.contains("ship it"), "\(label): reply bytes \(sent.debugDescription)")
            XCTAssertTrue(sent.contains("\r"), "\(label): reply submitted with Enter")
            XCTAssertTrue(sent.hasSuffix("\u{1b}"), "\(label): esc after the reply")
        }

        // History scrolls under the keyboard; a pull down outside the terminal dismisses it. The drag stays inside
        // the terminal: XCUI's swipeDown() travels past the bottom of the short landscape terminal.
        term.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
            .press(forDuration: 0.05, thenDragTo: term.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(kb.isUp, "\(label): scrolling the terminal dropped the keyboard")
        let bar = el("composerBar")
        bar.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            .press(forDuration: 0.05, thenDragTo: bar.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 3)))
        XCTAssertTrue(kb.waitDown(), "\(label): pulling the reply bar down left the keyboard up")
    }

    private func landscape(fixture: String?) throws {
        try start(.light, fixture: fixture)
        XCUIDevice.shared.orientation = .landscapeLeft
        label = label.replacingOccurrences(of: "portrait", with: "landscape")
        Thread.sleep(forTimeInterval: 1)
        sweepNewTask()
        openTask()
        let lm = ["taskTitle"]
        check("detail-composer", { self.input("composerField") }, landmarks: lm, whileUp: { self.assertTerminalBlock() })
        check("detail-terminal", { self.el("terminal") }, landmarks: lm, whileUp: { self.assertTerminalBlock() })
        terminalChecks(log: fixture.flatMap { FixtureLog(socketURL: $0) })
    }

    // MARK: The per-input check

    /// Focuses the input (`focus`, else a tap on it), then: keyboard up; the input holds the focus, sits wholly
    /// above the keyboard and its bar, and is hittable (no header over it); `keyboardDone` on screen. Done drops
    /// the keyboard and the focus, and every landmark ends within 1 pt of where it was before.
    func check(_ name: String, _ field: @escaping () -> XCUIElement, focus: (() -> Void)? = nil,
               landmarks: [String] = [], whileUp: (() -> Void)? = nil) {
        let tag = "\(label) \(name)"
        if kb.isUp { dismiss() }
        let marks = landmarks.map { visible($0) }
        let before = marks.map(\.frame)
        if let focus { focus() } else {
            guard field().waitForExistence(timeout: 15) else { return XCTFail("\(tag): input never appeared") }
            field().tap()
        }
        guard kb.waitUp() else { return XCTFail("\(tag): no keyboard") }
        let px = screen(), f = field(), top = kb.coveredTop(px)
        XCTAssertLessThanOrEqual(f.frame.maxY, top + 0.5, "\(tag): input ends at \(f.frame.maxY), keyboard starts at \(top)")
        XCTAssertGreaterThan(f.frame.height, 0, "\(tag): input collapsed")
        XCTAssertTrue(f.isHittable, "\(tag): input covered")
        XCTAssertTrue(holdsFocus(f), "\(tag): focus is on \(focusHolder()), not the input")
        assertKeyboardLook(tag)
        shot(name)
        whileUp?()
        guard let done = kb.done else {
            XCTFail("\(tag): no keyboardDone over the keyboard")
            return dismiss()
        }
        // Reveal may still be scrolling the field clear of the bar; a tap during that lands on whatever slides
        // under it. Wait for the field and `done` to hold still first.
        waitStill(f, done)
        done.tap()
        XCTAssertTrue(kb.waitDown(), "\(tag): keyboard still up after Done at \(done.frame); focus on \(focusHolder())")
        XCTAssertFalse(holdsFocus(f), "\(tag): input kept focus after Done")
        for (mark, was) in zip(marks, before) {
            let now = mark.frame
            XCTAssertTrue(abs(now.minY - was.minY) <= 1 && abs(now.height - was.height) <= 1,
                          "\(tag): \(mark.identifier) moved from \(was) to \(now)")
        }
    }

    /// Until every element's frame is the same in two samples 0.25 s apart (at most 3 s).
    private func waitStill(_ elements: XCUIElement...) {
        let deadline = Date().addingTimeInterval(3)
        var last = elements.map(\.frame)
        while Date() < deadline {
            Thread.sleep(forTimeInterval: 0.25)
            let now = elements.map(\.frame)
            if now == last { return }
            last = now
        }
    }

    private func focused() -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
    }

    /// The first responder is this input or inside it (wrappers: FieldBox, PromptEditor, the terminal pane).
    private func holdsFocus(_ input: XCUIElement) -> Bool {
        let f = focused()
        guard f.exists else { return false }
        return input.frame.insetBy(dx: -1, dy: -1).contains(CGPoint(x: f.frame.midX, y: f.frame.midY))
    }

    private func focusHolder() -> String {
        let f = focused()
        return f.exists ? "\(f.elementType.rawValue) '\(f.identifier)' \(f.frame)" : "nothing"
    }

    /// Keyboard colors follow the theme: sampled below the keys, where only the keyboard's own backdrop is.
    private func assertKeyboardLook(_ tag: String) {
        let k = kb.keyboard.frame
        let lum = screen().luminance(in: CGRect(x: k.midX - 20, y: k.maxY - 14, width: 40, height: 6))
        if appearance == .dark {
            XCTAssertLessThan(lum, 0.35, "\(tag): light keyboard on the dark theme (luminance \(lum))")
        } else {
            XCTAssertGreaterThan(lum, 0.6, "\(tag): dark keyboard on the light theme (luminance \(lum))")
        }
    }

    /// A sheet's primary button can be brought on screen, above the keyboard, without dropping it.
    func assertReachable(_ id: String) {
        let e = visible(id)
        for _ in 0..<4 where !(e.isHittable && e.frame.maxY <= kb.coveredTop(screen()) + 0.5) {
            app.swipeUp()
        }
        XCTAssertTrue(e.isHittable, "\(label): \(id) cannot be reached with the keyboard up")
        XCTAssertLessThanOrEqual(e.frame.maxY, kb.coveredTop(screen()) + 0.5, "\(label): \(id) stays under the keyboard")
        XCTAssertTrue(kb.isUp, "\(label): reaching \(id) dropped the keyboard")
    }

    /// Without Done (a failure already recorded), the return key, so the sweep can go on.
    func dismiss() {
        if let done = kb.done { done.tap() } else {
            let keys = ["return", "Return", "done", "Done", "search", "Search", "send", "Send", "go", "Go"]
            app.keyboards.buttons.matching(NSPredicate(format: "label IN %@", keys)).firstMatch.tap()
        }
        kb.waitDown(timeout: 3)
    }

    // MARK: Elements

    func el(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The on-screen element with this id: ids repeat between a presenter and its sheet.
    func visible(_ id: String) -> XCUIElement {
        let all = app.descendants(matching: .any).matching(identifier: id).allElementsBoundByIndex
        return all.last { $0.isHittable } ?? all.last ?? el(id)
    }

    /// The editable element for an id. An id on a wrapper (FieldBox, PromptEditor) also lands on its children,
    /// placeholder text included, so editable matches win; else the first editable inside the wrapper.
    func input(_ id: String) -> XCUIElement {
        for q in [app.textViews, app.textFields, app.secureTextFields] {
            let hits = q.matching(identifier: id).allElementsBoundByIndex
            if let e = hits.last(where: { $0.isHittable }) ?? hits.last { return e }
        }
        let e = visible(id)
        for q in [e.textViews, e.textFields, e.secureTextFields] where q.firstMatch.exists { return q.firstMatch }
        return e
    }

    @discardableResult
    func waitFor(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 15) -> XCUIElement {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "\(label): timed out waiting for \(what)")
        return e
    }

    private func waitForInput(_ log: FixtureLog, until: (String) -> Bool) -> String {
        let deadline = Date().addingTimeInterval(5)
        var sent = log.input()
        while !until(sent), Date() < deadline { Thread.sleep(forTimeInterval: 0.2); sent = log.input() }
        return sent
    }

    private func waitForSize(_ log: FixtureLog, until: ((cols: Int, rows: Int)) -> Bool) -> (cols: Int, rows: Int)? {
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if let s = log.lastSize(), until(s) { return s }
            Thread.sleep(forTimeInterval: 0.2)
        }
        return nil
    }

    private func shot(_ name: String) {
        guard let dir = env["ROVE_SHOT_DIR"], !dir.isEmpty else { return }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let url = URL(fileURLWithPath: dir).appendingPathComponent("\(label)-\(name).png")
        try? screen().upright.pngData()?.write(to: url)
    }

    func screen() -> Pixels { Pixels(XCUIScreen.main.screenshot()) }
}
