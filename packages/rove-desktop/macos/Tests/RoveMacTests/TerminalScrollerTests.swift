import AppKit
import XCTest
@testable import RoveMac

final class TerminalScrollerTests: XCTestCase {
    @MainActor func testOutputKeepsTheTrackClearAndDraggingMovesTheGhosttyViewport() async throws {
        let pane = NativePane(id: "shell") { _ in }
        let window = mountTerminal(pane)
        defer { window.contentView = nil }
        let lines = (1...160).map { "row \($0)" }.joined(separator: "\r\n")
        pane.feed(Data(lines.utf8), op: "data", chars: 0)
        let bar = pane.scroller
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            bar.isEnabled && !bar.isHidden && pane.columns > 0 && bar.doubleValue > 0.9
        }, object: nil)], timeout: 5)
        XCTAssertEqual(bar.alphaValue, 0)
        let cols = pane.columns
        pane.scrollPage(-1)
        XCTAssertEqual(bar.alphaValue, 1)
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in bar.doubleValue < 0.9 }, object: nil)], timeout: 3)
        let knob = bar.rect(for: .knob)
        let start = bar.doubleValue
        func event(_ type: NSEvent.EventType, offset: CGFloat) throws -> NSEvent {
            let point = bar.convert(NSPoint(x: knob.midX, y: knob.midY + offset), to: nil)
            return try XCTUnwrap(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: 0,
                                                    windowNumber: window.windowNumber, context: nil,
                                                    eventNumber: 1, clickCount: 1, pressure: 1))
        }
        bar.mouseDown(with: try event(.leftMouseDown, offset: 0))
        bar.mouseDragged(with: try event(.leftMouseDragged, offset: 50))
        bar.mouseUp(with: try event(.leftMouseUp, offset: 50))
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            bar.doubleValue > start + 0.1
        }, object: nil)], timeout: 3)
        XCTAssertEqual(pane.columns, cols)
        pane.feed(Data("\u{1b}[?1049h".utf8), op: "data", chars: 0)
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in bar.isHidden }, object: nil)], timeout: 3)
    }
}
