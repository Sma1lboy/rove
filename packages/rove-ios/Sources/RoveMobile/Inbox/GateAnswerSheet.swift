import SwiftUI

/// A decision a task put to its owner: the question, one tile per option (the recommended one marked),
/// an optional note; submit sends `gate.answer`. A gate with no options is answered by the text alone.
struct GateAnswerSheet: View {
    var gate: GateRow
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var option: String?
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?

    private var ready: Bool { !busy && (option != nil || !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }

    var body: some View {
        SheetScaffold(title: gate.label.isEmpty ? gate.taskId : gate.label, kicker: String(localized: "decision"), error: error,
                      primary: PrimaryBar(label: String(localized: "send answer"), enabled: ready, busy: busy,
                                          identifier: "gateSubmit") { Task { await submit() } }) {
            Text(gate.question).font(Theme.face(16, .medium)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let context = gate.context { Hint(text: context) }
            if !gate.options.isEmpty {
                FormSection(label: String(localized: "options"), trailing: String(format: "%02d", gate.options.count)) {
                    VStack(spacing: 6) { ForEach(gate.options, id: \.key) { optionTile($0) } }
                }
            }
            FormSection(label: gate.options.isEmpty ? String(localized: "answer") : String(localized: "note")) {
                PromptEditor(text: $note,
                             placeholder: gate.options.isEmpty ? String(localized: "type your answer") : String(localized: "optional note for the agent"),
                             minHeight: 88)
                    .accessibilityIdentifier("gateNote")
            }
        }
    }

    private func optionTile(_ o: GateOption) -> some View {
        let on = option == o.key
        return Button { option = on ? nil : o.key } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(o.key).font(Theme.mono(13, .semibold)).foregroundStyle(on ? Theme.accent : Theme.muted)
                    Text(o.label).font(Theme.mono(14, on ? .semibold : .medium)).foregroundStyle(on ? Theme.accent : Theme.ink)
                    if o.key == gate.recommended {
                        Text("recommended").font(Theme.mono(11)).foregroundStyle(Theme.accent)
                    }
                }
                if let detail = o.detail { Text(detail).font(Theme.face(13)).foregroundStyle(Theme.muted) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .selectableTile(on)
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier("gateOption-\(o.key)")
    }

    private func submit() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            try await model.store.answerGate(gate, option: option, text: note)
            dismiss()
        } catch let e as BridgeError {
            error = "\(e.code): \(e.message)"
        } catch {
            self.error = String(localized: "Could not send the answer.")
        }
    }
}
