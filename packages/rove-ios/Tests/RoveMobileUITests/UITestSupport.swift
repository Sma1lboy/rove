import XCTest

extension XCUIElement {
    /// Focuses the field, deletes what it holds, types `text`.
    func clearAndType(_ text: String) {
        tap()
        let current = (value as? String) ?? ""
        if !current.isEmpty { typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count)) }
        typeText(text)
    }
}
