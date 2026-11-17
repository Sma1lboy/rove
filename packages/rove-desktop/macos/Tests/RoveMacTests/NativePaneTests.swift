import AppKit
import XCTest
@testable import RoveMac

final class NativePaneTests: XCTestCase {
    @MainActor func testCompositionCommitsOnceToItsSessionWithoutSubmitting() {
        _ = NSApplication.shared
        var input: [String] = []
        let pane = NativePane(id: "shell-A") { event in
            guard event["id"] as? String == "shell-A", event["action"] as? String == "input",
                  let text = event["data"] as? String else { return }
            input.append(text)
        }
        let replacement = NSRange(location: NSNotFound, length: 0)
        pane.view.setMarkedText("pin", selectedRange: NSRange(location: 3, length: 0), replacementRange: replacement)
        XCTAssertTrue(input.isEmpty)
        pane.view.insertText("拼", replacementRange: replacement)
        XCTAssertEqual(input, ["拼"])
    }

    @MainActor func testReplayedTerminalQueriesStayOutOfShellInput() {
        _ = NSApplication.shared
        var actions: [String] = []
        let pane = NativePane(id: "shell-B") { event in
            if let action = event["action"] as? String { actions.append(action) }
        }
        let query = Data("\u{1b}[6n".utf8)
        pane.feed(query, op: "reset", chars: query.base64EncodedString().count)
        XCTAssertFalse(actions.contains("input"))
        XCTAssertFalse(actions.contains("reply"))
        XCTAssertTrue(actions.contains("parsed"))
    }
}
