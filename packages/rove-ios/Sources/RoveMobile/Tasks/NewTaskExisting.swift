import SwiftUI

/// Repo tiles shared by the existing, open-project and adopt modes.
struct RepoTiles: View {
    var repos: [String]
    var loading: Bool
    @Binding var selection: String

    var body: some View {
        FormSection(label: "repository", trailing: repos.isEmpty ? nil : String(format: "%02d", repos.count)) {
            if repos.isEmpty && loading { BrailleSpinner(size: 13) }
            VStack(spacing: 6) {
                ForEach(repos, id: \.self) { path in row(path) }
            }
        }
    }

    private func row(_ path: String) -> some View {
        let on = path == selection
        return Button { withAnimation(Theme.spring) { selection = path } } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(URL(fileURLWithPath: path).lastPathComponent)
                    .font(Theme.mono(14, on ? .semibold : .medium))
                    .foregroundStyle(on ? Theme.accent : Theme.ink)
                Text(path).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.head)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .selectableTile(on)
        }
        .buttonStyle(.pressable)
    }
}

/// Mode `existing`: repo, engine, base, title, first prompt and the collapsible options.
/// Also where `clone` lands, with the new path selected.
struct NewTaskExistingForm: View {
    @Bindable var draft: NewTaskDraft

    var body: some View {
        if let notice = draft.notice { Hint(text: notice) }
        RepoTiles(repos: draft.repos, loading: !draft.loadedLists, selection: $draft.spawn.repo)
        FormSection(label: "engine") {
            if !draft.engines.isEmpty { EnginePicker(engines: draft.engines, selection: $draft.spawn.engine) }
        }
        if !draft.branches.isEmpty {
            FormSection(label: "base", trailing: "branch off") {
                BranchPicker(branches: draft.branches, selection: $draft.spawn.baseBranch)
            }
        }
        FormSection(label: "title") {
            FieldBox {
                TextField("", text: $draft.spawn.title, prompt: Text("optional — derived from the prompt").foregroundStyle(Theme.muted))
                    .accessibilityIdentifier("titleField")
            }
        }
        FormSection(label: "first prompt") {
            PromptEditor(text: $draft.spawn.prompt, placeholder: "leave empty to open the worktree without starting the engine")
                .accessibilityIdentifier("promptEditor")
        }
        NewTaskOptions(draft: draft)
        if let blocker = draft.spawn.blocker, !draft.spawn.repo.isEmpty { Hint(text: blocker) }
    }
}

/// Mode `open project`: the project checkout itself becomes a task.
struct NewTaskOpenForm: View {
    @Bindable var draft: NewTaskDraft

    var body: some View {
        RepoTiles(repos: draft.repos, loading: !draft.loadedLists, selection: $draft.spawn.repo)
        Hint(text: "the project checkout itself, no new worktree.")
    }
}
