import AppKit
import XCTest
@testable import RoveMac

@MainActor
func mountTerminal(_ pane: NativePane) -> NSWindow {
    _ = NSApplication.shared
    let frame = NSRect(x: 0, y: 0, width: 640, height: 320)
    let window = NSWindow(contentRect: frame, styleMask: [.titled], backing: .buffered, defer: false)
    pane.view.frame = frame
    window.contentView = pane.view
    pane.view.layoutSubtreeIfNeeded()
    pane.view.fitToSize()
    return window
}

final class NativePaneTests: XCTestCase {
    @MainActor func testMarkedTextCommitsOnceAndReturnReachesTheAttachedShell() async {
        var input = ""
        let submit = expectation(description: "composed input and Return reached shell A")
        let pane = NativePane(id: "shell-A") { event in
            guard event["id"] as? String == "shell-A", event["action"] as? String == "input",
                  let text = event["data"] as? String else { return }
            input += text
            if input.hasSuffix("\r") { submit.fulfill() }
        }
        let window = mountTerminal(pane)
        defer { window.contentView = nil }
        XCTAssertNotNil(pane.surface)
        let replacement = NSRange(location: NSNotFound, length: 0)
        pane.view.setMarkedText("拼", selectedRange: NSRange(location: 1, length: 0), replacementRange: replacement)
        XCTAssertTrue(input.isEmpty)
        XCTAssertTrue(pane.view.sendKey(.enter))
        await fulfillment(of: [submit], timeout: 4)
        XCTAssertEqual(input, "拼\r")
    }

    @MainActor func testReplayedShellOutputIsParsedWithoutTypingHistoricalReplies() async {
        var input = ""
        let ack = expectation(description: "live output parsed")
        let pane = NativePane(id: "shell-B") { event in
            if event["action"] as? String == "input" { input += event["data"] as? String ?? "" }
            if event["action"] as? String == "parsed" { ack.fulfill() }
        }
        let window = mountTerminal(pane)
        defer { window.contentView = nil }
        XCTAssertNotNil(pane.surface)
        pane.feed(Data("old\r\n\u{1b}[6n".utf8), op: "replay", chars: 0)
        pane.feed(Data("\u{1b}[2J\u{1b}[H\u{1b}[32m终端\u{1b}[0m".utf8), op: "data", chars: 64)
        await fulfillment(of: [ack], timeout: 4)
        XCTAssertTrue(pane.session.readViewportText()?.hasPrefix("终端") == true)
        XCTAssertEqual(input, "")
    }
}
