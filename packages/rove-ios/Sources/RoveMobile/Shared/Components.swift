import SwiftUI

// Screen and sheet building blocks in the quill grammar (DESIGN.md "Component grammar").
// Every new screen composes these instead of system Form/List chrome.

/// Kicker label over its content — one field or group of a form.
struct FormSection<Content: View>: View {
    var label: String
    var trailing: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Theme.kicker(label)
                Spacer()
                if let trailing { Theme.kicker(trailing) }
            }
            content
        }
    }
}

/// Prose hint under a field: system face, muted.
struct Hint: View {
    var text: String
    var body: some View {
        Text(text).font(Theme.face(14)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
    }
}

/// A failure line. Error red is for failures only.
struct ErrorLine: View {
    var text: String
    var body: some View {
        Text(text).font(Theme.mono(12)).foregroundStyle(Theme.error)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Two mono lines: what is empty, and what fills it.
struct EmptyState: View {
    var title: String
    var detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink)
            Text(detail).font(Theme.mono(12)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Choose-one row of mono tiles; the selected tile takes the accent wash (the pairing preset grammar).
struct ChoiceTiles<Value: Hashable>: View {
    var options: [Value]
    @Binding var selection: Value
    var label: (Value) -> String
    var fill = true

    var body: some View {
        HStack(spacing: 6) {
            ForEach(options, id: \.self) { option in
                let on = option == selection
                Button { withAnimation(Theme.spring) { selection = option } } label: {
                    Text(label(option))
                        .font(Theme.mono(13, on ? .semibold : .regular))
                        .foregroundStyle(on ? Theme.accent : Theme.ink)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .frame(maxWidth: fill ? .infinity : nil, minHeight: 40)
                        .selectableTile(on)
                }
                .buttonStyle(.pressable)
            }
        }
    }
}

/// The full-width primary action, quill record-bar grammar: accent fill when enabled,
/// inset when not; `destructive` swaps in the error slot (deleting is not an accent action).
struct PrimaryBar: View {
    var label: String
    var enabled = true
    var destructive = false
    var busy = false
    /// Accessibility identifier: an English constant, never derived from the (localized) label.
    var identifier: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(label).font(Theme.mono(16, .semibold))
                Spacer()
                if busy { BrailleSpinner(size: 14, tint: Theme.paper) } else { Text("→").font(Theme.mono(16, .semibold)) }
            }
            .foregroundStyle(enabled ? Theme.paper : Theme.muted)
            .padding(.horizontal, 18)
            .frame(height: 56)
            .background(enabled ? (destructive ? Theme.error : Theme.accent) : Theme.inset,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.pressable)
        .disabled(!enabled || busy)
        .accessibilityIdentifier(identifier)
    }
}

/// Sheet chrome: mono title row with a `close` text button, scrolling body, optional primary bar.
/// Solid paper, no system navigation bar.
struct SheetScaffold<Content: View>: View {
    var title: String
    var kicker: String? = nil
    var error: String? = nil
    var primary: PrimaryBar? = nil
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    if let kicker { Theme.kicker(kicker) }
                    Text(title).font(Theme.face(20, .semibold)).foregroundStyle(Theme.ink)
                        .accessibilityAddTraits(.isHeader)
                }
                Spacer()
                Button { dismiss() } label: {
                    Text("close").font(Theme.mono(14)).foregroundStyle(Theme.muted).frame(minWidth: 44, minHeight: 36)
                }
                .buttonStyle(.pressable)
                .accessibilityIdentifier("sheetClose")
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) { content }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            if error != nil || primary != nil {
                VStack(alignment: .leading, spacing: 8) {
                    if let error { ErrorLine(text: error) }
                    primary
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
        }
        .quillSheetChrome()
    }
}

/// The app's sheets, one look: paper body, and the `Theme.scrim` drawn by `RootView` in place of the
/// system dim (enabling background interaction is what removes the system dim). Tapping the scrim
/// dismisses the topmost sheet, as tapping the system dim did.
struct QuillSheetChrome: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .background(Theme.paper.ignoresSafeArea())
            .presentationBackground(Theme.paper)
            .presentationBackgroundInteraction(.enabled(upThrough: .large))
            .onAppear { withAnimation(Theme.spring) { model.sheets.append(id) } }
            .onDisappear { withAnimation(Theme.spring) { model.sheets.removeAll { $0 == id } } }
            .onChange(of: model.dismissSheet) { _, target in if target == id { dismiss() } }
    }
}

extension View {
    func quillSheetChrome() -> some View { modifier(QuillSheetChrome()) }
}

/// The one modal scrim, under every sheet; owned by `RootView`.
struct SheetScrim: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let top = model.sheets.last {
            Theme.scrim
                .ignoresSafeArea()
                .onTapGesture { model.dismissSheet = top }
                .transition(.opacity)
                .accessibilityHidden(true)
        }
    }
}

/// One tappable list row: mono label, optional detail, chevron-free (rows are the affordance).
struct ActionRow: View {
    var title: String
    var detail: String? = nil
    var tint: Color = Theme.ink
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title).font(Theme.mono(14, .medium)).foregroundStyle(tint)
                Spacer()
                if let detail { Text(detail).font(Theme.mono(12)).foregroundStyle(Theme.muted).lineLimit(1) }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 46)
        }
        .buttonStyle(RowButtonStyle())
    }
}

/// A multi-line prompt editor on a surface tile, with a muted placeholder.
struct PromptEditor: View {
    @Binding var text: String
    var placeholder: String
    var minHeight: CGFloat = 120

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(placeholder).font(Theme.face(16)).foregroundStyle(Theme.muted)
                    .padding(.horizontal, 13).padding(.vertical, 12)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $text)
                .font(Theme.face(16))
                .foregroundStyle(Theme.ink)
                .tint(Theme.accent)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .frame(minHeight: minHeight)
        }
        .tile()
    }
}
