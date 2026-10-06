import SwiftUI

/// New task: `existing` repo (task.spawn), `open project` (task.openMain), `clone` (repo.clone,
/// then the existing form) or `adopt` (worktree.adopt). The last repo and engine are remembered
/// on this phone, as the TUI's dialog remembers its own.
struct NewTaskView: View {
    var onCreated: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage("newTask.repo") private var lastRepo = ""
    @AppStorage("newTask.engine") private var lastEngine = ""
    @State private var draft = NewTaskDraft()

    private struct LoadKey: Hashable {
        var repo: String
        var mode: NewTaskMode
    }

    var body: some View {
        SheetScaffold(title: "new task", kicker: kicker, error: draft.error,
                      primary: PrimaryBar(label: primaryLabel, enabled: draft.canCreate, busy: draft.busy,
                                          identifier: "createButton") { Task { await run() } }) {
            ScrollView(.horizontal, showsIndicators: false) {
                ChoiceTiles(options: NewTaskMode.allCases, selection: $draft.mode, label: \.label, fill: false)
            }
            .accessibilityIdentifier("modePicker")
            switch draft.mode {
            case .existing: NewTaskExistingForm(draft: draft)
            case .openProject: NewTaskOpenForm(draft: draft)
            case .clone: NewTaskCloneForm(draft: draft)
            case .adopt: NewTaskAdoptForm(draft: draft)
            }
        }
        .task { await draft.loadLists(client: model.client, preferred: [model.store.repoFilter, lastRepo].compactMap { $0 }, lastEngine: lastEngine) }
        .task(id: LoadKey(repo: draft.spawn.repo, mode: draft.mode)) {
            switch draft.mode {
            case .existing: await draft.loadBranches(client: model.client)
            case .adopt: await draft.loadAdoptable(client: model.client)
            case .openProject, .clone: break
            }
        }
        .onChange(of: draft.spawn.engine) { draft.engineChanged() }
        .onChange(of: draft.mode) { draft.error = nil }
    }

    private var kicker: String {
        switch draft.mode {
        case .existing: "worktree + branch"
        case .openProject: "the project checkout"
        case .clone: "git clone"
        case .adopt: "existing worktrees"
        }
    }

    private var primaryLabel: String {
        switch draft.mode {
        case .existing: draft.spawn.isFanOut ? "create \(draft.spawn.fanOutTotal) tasks" : "create task"
        case .openProject: "open project"
        case .clone: draft.busy ? "cloning…" : "clone"
        case .adopt:
            if let p = draft.progress { "adopting \(p)" } else { draft.adopt.count > 0 ? "adopt \(draft.adopt.count)" : "adopt" }
        }
    }

    private func run() async {
        let finish = await draft.perform(client: model.client)
        if finish != .stay { lastRepo = draft.spawn.repo; lastEngine = draft.spawn.engine }
        switch finish {
        case .stay: break
        case .dismiss: dismiss()
        case .open(let id): dismiss(); onCreated(id)
        }
    }
}
