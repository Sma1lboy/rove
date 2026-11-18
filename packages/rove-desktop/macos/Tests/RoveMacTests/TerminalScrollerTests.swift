import AppKit
import XCTest
@testable import RoveMac

final class TerminalScrollerTests: XCTestCase {
    @MainActor func testOutputKeepsTheTrackClearUntilTheReaderMovesIntoScrollback() {
        _ = NSApplication.shared
        let pane = NativePane(id: "shell") { _ in }
        pane.view.frame = NSRect(x: 0, y: 0, width: 640, height: 320)
        pane.view.layoutSubtreeIfNeeded()
        let columns = pane.view.getTerminal().cols
        let lines = (1...120).map { "line \($0)" }.joined(separator: "\r\n")
        pane.feed(Data(lines.utf8), op: "data", chars: 0)
        XCTAssertTrue(pane.view.canScroll)
        XCTAssertEqual(pane.scroller.alphaValue, 0)
        pane.view.pageUp()
        XCTAssertEqual(pane.scroller.alphaValue, 1)
        XCTAssertEqual(pane.scroller.doubleValue, pane.view.scrollPosition)
        XCTAssertEqual(pane.view.getTerminal().cols, columns)

        pane.feed(Data("\u{1b}[?1049h".utf8), op: "data", chars: 0)
        XCTAssertTrue(pane.scroller.isHidden)
    }
    @MainActor func testDraggingDownMovesTowardRecentOutputWithoutResizingTheShell() throws {
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 320),
                              styleMask: [.titled], backing: .buffered, defer: false)
        let pane = NativePane(id: "shell") { _ in }
        window.contentView = pane.view
        pane.view.layoutSubtreeIfNeeded()
        pane.feed(Data(String(repeating: "scrollback\r\n", count: 160).utf8), op: "data", chars: 0)
        pane.view.scroll(toPosition: 0.25)
        let bar = pane.scroller
        let columns = pane.view.getTerminal().cols
        let before = pane.view.scrollPosition
        let knob = bar.rect(for: .knob)
        func event(_ type: NSEvent.EventType, offset: CGFloat) throws -> NSEvent {
            let point = bar.convert(NSPoint(x: knob.midX, y: knob.midY + offset), to: nil)
            return try XCTUnwrap(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: 0,
                                                    windowNumber: window.windowNumber, context: nil,
                                                    eventNumber: 1, clickCount: 1, pressure: 1))
        }
        bar.mouseDown(with: try event(.leftMouseDown, offset: 0))
        bar.mouseDragged(with: try event(.leftMouseDragged, offset: 50))
        bar.mouseUp(with: try event(.leftMouseUp, offset: 50))
        XCTAssertGreaterThan(pane.view.scrollPosition, before + 0.1)
        XCTAssertEqual(bar.doubleValue, pane.view.scrollPosition)
        XCTAssertEqual(pane.view.getTerminal().cols, columns)
    }

}
