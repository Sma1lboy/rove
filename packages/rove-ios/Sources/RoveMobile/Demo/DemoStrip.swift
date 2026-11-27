import SwiftUI

/// The permanent strip over every screen while the app runs against the in-app fixture bridge.
/// Inset fill, mono, muted status; accent only on the one button, which leaves demo mode.
struct DemoStrip: View {
    @Environment(AppModel.self) private var model: AppModel?
    var status = String(localized: "demo · not connected to a mac")
    var action = String(localized: "connect a mac")
    /// Leaves the demo; the native app's own model when absent.
    var exit: (() -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            Text(status)
                .font(Theme.mono(11, .medium))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .accessibilityIdentifier("demoStatus")
            Spacer(minLength: 8)
            Button { Haptic.play(); withAnimation(Theme.spring) { exit?() ?? model?.exitDemo() } } label: {
                Text(action)
                    .font(Theme.mono(11, .semibold))
                    .foregroundStyle(Theme.accent)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(minHeight: 44)
            }
            .buttonStyle(.pressable)
            .accessibilityIdentifier("demoConnect")
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .background(Theme.inset.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }
}
