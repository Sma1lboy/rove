import CoreText
import SwiftTerm
import XCTest
@testable import RoveMobile

@MainActor
final class TerminalFontTests: XCTestCase {
    /// Both terminal modes draw in the bundled Maple Mono NF, which carries the Nerd Font icons engines print.
    func testTerminalDrawsInMapleMonoNFInBothModes() {
        let session = TerminalSession(client: BridgeClient(), taskId: "T-1", tabId: "tab-1")
        let coordinator = SwiftTermView.Coordinator(session: session)
        let tv = RoveTerminalView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))

        coordinator.applyMode(.fit, to: tv)
        XCTAssertEqual(tv.font.familyName, "Maple Mono NF")
        XCTAssertEqual(tv.font.pointSize, 13)
        var folder: [UniChar] = [0xF07B], glyph: [CGGlyph] = [0]
        XCTAssertTrue(CTFontGetGlyphsForCharacters(tv.font as CTFont, &folder, &glyph, 1), "nf-fa-folder has a glyph")

        coordinator.applyMode(.watch, to: tv)
        XCTAssertEqual(tv.font.familyName, "Maple Mono NF")
    }
}
