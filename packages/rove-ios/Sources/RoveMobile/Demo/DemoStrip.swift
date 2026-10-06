import SwiftUI

/// The permanent strip over every screen while the app runs against the in-app fixture bridge.
/// Inset fill, mono, muted status; accent only on the one button, which leaves demo mode.
struct DemoStrip: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 8) {
            Text("demo · not connected to a mac")
                .font(Theme.mono(11, .medium))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .accessibilityIdentifier("demoStatus")
            Spacer(minLength: 8)
            Button { withAnimation(Theme.spring) { model.exitDemo() } } label: {
                Text("connect a mac")
                    .font(Theme.mono(11, .semibold))
                    .foregroundStyle(Theme.accent)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(minHeight: 32)
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
