import AppKit
import GhosttyTerminal

/// Ghostty reports viewport geometry in rows. The overlay shares the web terminal’s track and reveal behavior.
final class TerminalScroller: NSScroller {
    var scrollTo: ((UInt) -> Void)?
    private var maximumRow: UInt = 0
    private var hideJob: DispatchWorkItem?
    private var hoverArea: NSTrackingArea?
    private var hovered = false
    private var dragOffset: CGFloat?
    var subtle = NSColor.secondaryLabelColor
    var muted = NSColor.labelColor

    init(terminal: NSView) {
        super.init(frame: NSRect(x: 0, y: 0, width: 8, height: 100))
        scrollerStyle = .legacy
        alphaValue = 0
        target = self
        action = #selector(scrollTerminal)
        setAccessibilityLabel("Terminal scrollback")
        terminal.addSubview(self)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            trailingAnchor.constraint(equalTo: terminal.trailingAnchor),
            topAnchor.constraint(equalTo: terminal.topAnchor),
            bottomAnchor.constraint(equalTo: terminal.bottomAnchor),
            widthAnchor.constraint(equalToConstant: 8),
        ])
        isHidden = true
    }

    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    func update(_ geometry: TerminalScrollbar) {
        maximumRow = UInt(geometry.total - min(geometry.len, geometry.total))
        doubleValue = maximumRow > 0 ? min(1, Double(geometry.offset) / Double(maximumRow)) : 0
        knobProportion = geometry.total > 0 ? min(1, CGFloat(geometry.len) / CGFloat(geometry.total)) : 1
        isEnabled = maximumRow > 0
        isHidden = !isEnabled
        if hovered, dragOffset == nil {
            hovered = window.map { $0.isKeyWindow && rect(for: .knob).contains(convert($0.mouseLocationOutsideOfEventStream, from: nil)) } ?? false
        }
        needsDisplay = true
        if !isEnabled {
            hideJob?.cancel()
            alphaValue = 0
            hovered = false
        }
    }

    func revealForUserScroll() {
        if isEnabled { reveal() }
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
        guard let dragOffset, maximumRow > 0 else { return }
        let travel = bounds.height - rect(for: .knob).height
        guard travel > 0 else { return }
        let y = convert(event.locationInWindow, from: nil).y - dragOffset
        scrollTo?(UInt((min(1, max(0, y / travel)) * Double(maximumRow)).rounded()))
    }

    override func mouseUp(with event: NSEvent) {
        guard dragOffset != nil else { return }
        dragOffset = nil
        hovered = rect(for: .knob).contains(convert(event.locationInWindow, from: nil))
        reveal()
    }

    @objc private func scrollTerminal() {
        scrollTo?(UInt((min(1, max(0, doubleValue)) * Double(maximumRow)).rounded()))
    }
}
