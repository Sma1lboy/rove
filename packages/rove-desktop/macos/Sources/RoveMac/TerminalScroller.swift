import AppKit
import SwiftTerm

/// SwiftTerm owns scrollback. This overlay gives its native scroller the web terminal's hit area and reveal behavior.
final class TerminalScroller: NSScroller {
    private weak var terminal: TerminalView?
    private var hideJob: DispatchWorkItem?
    private var hoverArea: NSTrackingArea?
    private var hovered = false
    private var dragOffset: CGFloat?
    var subtle = NSColor.secondaryLabelColor
    var muted = NSColor.labelColor

    init(terminal: TerminalView) {
        self.terminal = terminal
        super.init(frame: NSRect(x: 0, y: 0, width: 8, height: 100))
        scrollerStyle = .legacy
        alphaValue = 0
        target = self
        action = #selector(scrollTerminal)
        setAccessibilityLabel("Terminal scrollback")
        // Hiding SwiftTerm's own scroller also returns its reserved column width to the terminal.
        terminal.subviews.compactMap { $0 as? NSScroller }.first?.isHidden = true
        terminal.addSubview(self)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            trailingAnchor.constraint(equalTo: terminal.trailingAnchor),
            topAnchor.constraint(equalTo: terminal.topAnchor),
            bottomAnchor.constraint(equalTo: terminal.bottomAnchor),
            widthAnchor.constraint(equalToConstant: 8),
        ])
        sync(fromUser: false)
    }

    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    func sync(fromUser: Bool) {
        guard let terminal else { return }
        let changed = doubleValue != terminal.scrollPosition
        doubleValue = terminal.scrollPosition
        knobProportion = min(1, terminal.scrollThumbsize)
        isEnabled = terminal.canScroll
        isHidden = !isEnabled
        if hovered, dragOffset == nil {
            hovered = window.map { $0.isKeyWindow && rect(for: .knob).contains(convert($0.mouseLocationOutsideOfEventStream, from: nil)) } ?? false
        }
        needsDisplay = true
        if !isEnabled {
            hideJob?.cancel()
            alphaValue = 0
            hovered = false
        } else if fromUser && changed {
            reveal()
        }
    }

    override func rect(for part: NSScroller.Part) -> NSRect {
        switch part {
        case .knobSlot: return bounds
        case .knob:
            let height = min(bounds.height, max(20, bounds.height * knobProportion))
            return NSRect(x: 0, y: (bounds.height - height) * doubleValue, width: bounds.width, height: height)
        default: return super.rect(for: part)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard isEnabled else { return }
        let pill = rect(for: .knob).insetBy(dx: 1, dy: 1)
        let color = dragOffset != nil ? muted : hovered ? subtle : subtle.withAlphaComponent(0.45)
        color.setFill()
        NSBezierPath(roundedRect: pill, xRadius: pill.width / 2, yRadius: pill.width / 2).fill()
    }

    private func reveal() {
        hideJob?.cancel()
        layer?.removeAllAnimations()
        alphaValue = 1
        needsDisplay = true
        guard dragOffset == nil else { return }
        let job = DispatchWorkItem { [weak self] in
            guard let self, self.dragOffset == nil else { return }
            if self.hovered, let window = self.window, window.isKeyWindow,
               self.rect(for: .knob).contains(self.convert(window.mouseLocationOutsideOfEventStream, from: nil)) { return }
            self.hovered = false
            NSAnimationContext.runAnimationGroup { context in
                context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.3
                self.animator().alphaValue = 0
            }
        }
        hideJob = job
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9, execute: job)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverArea { removeTrackingArea(hoverArea) }
        let area = NSTrackingArea(rect: bounds, options: [.activeInActiveApp, .mouseEnteredAndExited, .mouseMoved, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        hoverArea = area
    }

    override func mouseEntered(with event: NSEvent) { mouseMoved(with: event) }
    override func mouseMoved(with event: NSEvent) {
        let over = rect(for: .knob).contains(convert(event.locationInWindow, from: nil))
        guard alphaValue > 0, hovered != over else { return }
        hovered = over
        reveal()
    }
    override func mouseExited(with event: NSEvent) {
        guard hovered else { return }
        hovered = false
        reveal()
    }
    override func mouseDown(with event: NSEvent) {
        guard isEnabled else { return }
        let point = convert(event.locationInWindow, from: nil)
        let knob = rect(for: .knob)
        dragOffset = knob.contains(point) ? point.y - knob.minY : knob.height / 2
        mouseDragged(with: event)
        reveal()
    }

    override func mouseDragged(with event: NSEvent) {
        guard let dragOffset, let terminal, terminal.canScroll else { return }
        let travel = bounds.height - rect(for: .knob).height
        guard travel > 0 else { return }
        let y = convert(event.locationInWindow, from: nil).y - dragOffset
        terminal.scroll(toPosition: min(1, max(0, y / travel)))
    }

    override func mouseUp(with event: NSEvent) {
        guard dragOffset != nil else { return }
        dragOffset = nil
        hovered = rect(for: .knob).contains(convert(event.locationInWindow, from: nil))
        reveal()
    }

    @objc private func scrollTerminal() {
        switch hitPart {
        case .decrementPage: terminal?.pageUp()
        case .incrementPage: terminal?.pageDown()
        default: terminal?.scroll(toPosition: doubleValue)
        }
    }
}
