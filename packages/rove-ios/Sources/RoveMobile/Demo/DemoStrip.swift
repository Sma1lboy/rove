import SwiftUI

/// The permanent strip over every screen while the app runs against the in-app fixture bridge.
/// On the page colour over a hairline, mono muted status; one button, which leaves demo mode.
struct DemoStrip: View {
    @Environment(AppModel.self) private var model: AppModel?
    var status = String(localized: "demo · not connected to a mac")
    var action = String(localized: "connect a mac")
    /// Leaves the demo; the native app's own model when absent.
    /// The page under it, so the strip and the status bar read as part of the page.
    var fill = Theme.paper
    var exit: (() -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            Text(status)
                .font(Theme.mono(11, .medium))
                .foregroundStyle(Theme.muted)
                .lineLimit(2)
                .accessibilityIdentifier("demoStatus")
            Spacer(minLength: 8)
            PhoneButton(label: action, compact: true, identifier: "demoConnect") {
                withAnimation(Theme.spring) { exit?() ?? model?.exitDemo() }
            }
            .fixedSize()
        }
        .padding(.horizontal, 16).padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(fill.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 0.5) }
    }
}
