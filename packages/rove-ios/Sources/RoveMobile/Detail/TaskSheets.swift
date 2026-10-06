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

/// `rove api send --tab new`: a fresh engine tab in this task's worktree, with its first message.
struct NewTabSheet: View {
    let taskId: String
    var done: () async -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var engines: [Engine] = []
    @State private var engine = ""
    @State private var prompt = ""
    @State private var error: String?
    @State private var busy = false

    private var ready: Bool { !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        SheetScaffold(title: "new engine tab", kicker: "same worktree", error: error,
                      primary: PrimaryBar(label: "open tab", enabled: ready, busy: busy) { Task { await create() } }) {
            FormSection(label: "engine") {
                if engines.isEmpty { BrailleSpinner(size: 13) } else { EnginePicker(engines: engines, selection: $engine) }
            }
            FormSection(label: "first message") {
                PromptEditor(text: $prompt, placeholder: "what should this tab work on")
            }
            Hint(text: "Tabs share the worktree but keep their own process, scrollback and conversation.")
        }
        .task {
            do {
                engines = try await model.client.request("engines.list", as: EnginesResult.self).engines
                if engine.isEmpty { engine = engines.first?.id ?? "" }
            } catch { self.error = error.localizedDescription }
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        var args: [String: Any] = ["taskId": taskId, "prompt": prompt]
        if !engine.isEmpty { args["engine"] = engine }
        do {
            _ = try await model.client.request("tab.new", args, as: TabNewResult.self)
            await done()
            dismiss()
        } catch { self.error = error.localizedDescription }
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
        .accessibilityValue(on ? "on" : "off")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
