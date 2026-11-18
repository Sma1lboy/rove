import AppKit
import WebKit
import XCTest
@testable import RoveMac

final class WorkspaceContentTests: XCTestCase {
    @MainActor func testSidebarControlsShareTheWebRowAndLeaveTheWorkspaceClickable() throws {
        _ = NSApplication.shared
        let workspace = Workspace(address: URL(fileURLWithPath: "/"))
        let window = workspace.window
        let content = try XCTUnwrap(window.contentView as? WorkspaceContent)
        content.layoutSubtreeIfNeeded()
        let light = try XCTUnwrap(window.standardWindowButton(.closeButton))
        let frame = try XCTUnwrap(content.superview)
        let button = try XCTUnwrap(content.navigation.arrangedSubviews.first as? NSButton)
        let buttonCenter = button.convert(NSPoint(x: button.bounds.midX, y: button.bounds.midY), to: frame)
        let lightCenter = light.convert(NSPoint(x: light.bounds.midX, y: light.bounds.midY), to: frame)
        let workspacePoint = NSPoint(x: frame.bounds.midX, y: lightCenter.y)

        XCTAssertEqual(content.web.frame.maxY, content.bounds.maxY)
        XCTAssertEqual(buttonCenter.y, lightCenter.y, accuracy: 1)
        XCTAssertTrue(frame.hitTest(lightCenter) === light)
        XCTAssertTrue(frame.hitTest(buttonCenter) === button)
        XCTAssertTrue(try XCTUnwrap(frame.hitTest(workspacePoint)).isDescendant(of: workspace.web))

        content.update(folded: true, waiting: false, back: false, forward: false)
        content.layoutSubtreeIfNeeded()
        XCTAssertLessThanOrEqual(content.web.frame.maxY, content.navigation.frame.minY)
    }
}
