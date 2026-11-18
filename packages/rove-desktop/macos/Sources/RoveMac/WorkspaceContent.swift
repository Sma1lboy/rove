import AppKit
import WebKit

/// Occupy just the sidebar's control row; the workspace to its right has clickable tabs at the same height.
final class WorkspaceContent: NSView {
    let web: WKWebView
    let navigation = NSStackView()
    private let dragArea = WindowDragArea()
    private var buttons: [String: NSButton] = [:]
    private let navigate: (String) -> Void
    private var folded = false

    init(web: WKWebView, navigate: @escaping (String) -> Void) {
        self.web = web
        self.navigate = navigate
        super.init(frame: .zero)
        addSubview(web)
        addSubview(dragArea)
        navigation.orientation = .horizontal
        navigation.spacing = 2
        addSubview(navigation)
        for (id, label, symbol) in [("fold", "Toggle Sidebar", "sidebar.left"), ("back", "Back", "chevron.backward"), ("forward", "Forward", "chevron.forward")] {
            let button = NSButton(image: NSImage(systemSymbolName: symbol, accessibilityDescription: label)!,
                                  target: self, action: #selector(pressed(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(id)
            button.isBordered = false
            button.isEnabled = false
            button.toolTip = label
            button.setAccessibilityLabel(label)
            button.widthAnchor.constraint(equalToConstant: 24).isActive = true
            button.heightAnchor.constraint(equalToConstant: 24).isActive = true
            navigation.addArrangedSubview(button)
            buttons[id] = button
        }
    }

    required init?(coder: NSCoder) { nil }

    @objc private func pressed(_ sender: NSButton) {
        if let id = sender.identifier?.rawValue { navigate(id) }
    }

    override func layout() {
        super.layout()
        guard let window else { return }
        let lights = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton]
            .compactMap { window.standardWindowButton($0) }
            .filter { !$0.isHiddenOrHasHiddenAncestor && $0.window === window }
            .map { convert($0.bounds, from: $0) }
        let rtl = window.windowTitlebarLayoutDirection == .rightToLeft
        let innerEdge = rtl ? lights.map(\.minX).min() ?? bounds.maxX : lights.map(\.maxX).max() ?? bounds.minX
        let centerY = lights.first?.midY ?? bounds.maxY - 16
        let size = navigation.fittingSize
        let x = rtl ? innerEdge - 8 - size.width : innerEdge + 8
        navigation.frame = NSRect(x: x, y: centerY - size.height / 2, width: size.width, height: size.height)
        let rowHeight = ceil(max(28, 2 * (bounds.maxY - centerY)))
        let freeWidth = rtl ? navigation.frame.minX - bounds.minX : bounds.maxX - navigation.frame.maxX
        let gripWidth = folded ? freeWidth : min(32, freeWidth)
        dragArea.frame = NSRect(x: rtl ? navigation.frame.minX - gripWidth : navigation.frame.maxX,
                                y: bounds.maxY - rowHeight, width: gripWidth, height: rowHeight)
        // A folded rail lends its former space to page headings and session tabs.
        let inset = folded ? rowHeight : 0
        web.frame = NSRect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: max(0, bounds.height - inset))
    }

    func update(folded: Bool, waiting: Bool, back: Bool, forward: Bool) {
        if self.folded != folded { self.folded = folded; needsLayout = true }
        let label = folded ? "Show Sidebar" : "Hide Sidebar"
        buttons["fold"]?.setAccessibilityLabel(label)
        buttons["fold"]?.toolTip = waiting ? "\(label) · A task needs attention" : label
        buttons["fold"]?.contentTintColor = waiting ? .systemOrange : nil
        buttons["fold"]?.isEnabled = true
        buttons["back"]?.isEnabled = back
        buttons["forward"]?.isEnabled = forward
    }

    func reset() {
        folded = false
        needsLayout = true
        for button in buttons.values { button.isEnabled = false }
    }
}

private final class WindowDragArea: NSView {
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}
