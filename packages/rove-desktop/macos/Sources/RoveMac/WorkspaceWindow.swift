import AppKit

final class WorkspaceWindow: NSWindow {
    var focusChanged: ((NSResponder?) -> Void)?
    @discardableResult override func makeFirstResponder(_ responder: NSResponder?) -> Bool {
        let previous = firstResponder
        let accepted = super.makeFirstResponder(responder)
        if accepted && previous !== firstResponder { focusChanged?(firstResponder) }
        return accepted
    }
}
