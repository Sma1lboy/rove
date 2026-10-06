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
        .accessibilityValue(on ? "on" : "off")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// `rove api delete`: states the deletion boundary before anything changes.
struct DeleteConfirmSheet: View {
    let taskId: String
    var deleted: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var force = false
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        SheetScaffold(title: "delete this task?", kicker: "delete", error: error,
                      primary: PrimaryBar(label: "delete task", destructive: true, busy: busy,
                                          identifier: "confirmDeleteButton") { Task { await run() } }) {
            Text("Removes the task and its worktree. The git branch stays, so committed work is not lost.")
                .font(Theme.face(16)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            CheckRow(label: "Also discard uncommitted changes", on: $force)
                .accessibilityIdentifier("forceToggle")
            Hint(text: "Without this, a worktree with uncommitted changes is refused.")
        }
        .presentationDetents([.medium])
    }

    private func run() async {
        busy = true
        defer { busy = false }
        var args: [String: Any] = ["taskId": taskId]
        if force { args["force"] = true }
        do {
            _ = try await model.client.request("task.delete", args, as: TaskDeleteResult.self)
            dismiss()
            deleted()
        } catch { self.error = error.localizedDescription }
    }
}
