import SwiftUI

/// Engine picker shared by the new-task and new-tab sheets: mono tiles, scrolling when there are many.
struct EnginePicker: View {
    var engines: [Engine]
    @Binding var selection: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            ChoiceTiles(options: engines.map(\.id), selection: $selection, label: { id in
                engines.first { $0.id == id }?.name.lowercased() ?? id
            }, fill: false)
        }
        .accessibilityIdentifier("enginePicker")
    }
}

/// Mono checkbox row: `[x] label`, accent when on.
struct CheckRow: View {
    var label: String
    @Binding var on: Bool

    var body: some View {
        Button { withAnimation(Theme.spring) { on.toggle() } } label: {
            HStack(spacing: 10) {
                Text(on ? "[x]" : "[ ]").font(Theme.mono(14, .bold)).foregroundStyle(on ? Theme.accent : Theme.muted)
                Text(label).font(Theme.face(15)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                Spacer()
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .tile()
        }
        .buttonStyle(.pressable)
        .accessibilityValue(on ? String(localized: "on") : String(localized: "off"))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
