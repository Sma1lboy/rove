import SwiftUI

// Small edit sheets behind the task `…` menu: rename, branch, engine, model & effort, status.
// Each calls one bridge op, shows a failure in `ErrorLine` (via `SheetScaffold`), and refreshes the host.

/// `task.rename`: the title only; the git branch keeps its name.
struct RenameTaskSheet: View {
    var host: TaskActionHost
    let taskId: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var seeded = false
    @State private var error: String?
    @State private var busy = false

    private var original: String { model.store.task(id: taskId)?.title ?? "" }
    private var next: String? { TaskActionLogic.validTitle(title).flatMap { $0 == original ? nil : $0 } }

    var body: some View {
        SheetScaffold(title: String(localized: "rename task"), kicker: String(localized: "title"), error: error,
                      primary: PrimaryBar(label: String(localized: "rename"), enabled: next != nil, busy: busy, identifier: "renameConfirm") { Task { await save() } }) {
            FormSection(label: String(localized: "title"), trailing: "\(title.count)/200") {
                FieldBox { TextField("task title", text: $title).submitLabel(.done) }
                    .accessibilityIdentifier("renameField")
            }
            Hint(text: String(localized: "Changes the title only. The git branch keeps its name."))
        }
        .presentationDetents([.medium])
        .onAppear { if !seeded { title = original; seeded = true } }
    }

    private func save() async {
        guard let next else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await model.client.request("task.rename", ["taskId": taskId, "title": next], as: EmptyResult.self)
            await host.didMutate(taskId)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// `task.setBranch`: type a name, or tap one of the repo's local branches.
struct BranchSheet: View {
    var host: TaskActionHost
    let taskId: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var branch = ""
    @State private var branches: [String] = []
    @State private var current: String?
    @State private var loading = true
    @State private var seeded = false
    @State private var listError: String?
    @State private var error: String?
    @State private var busy = false

    private var row: TaskRow? { model.store.task(id: taskId) }
    private var next: String? { TaskActionLogic.validBranch(branch).flatMap { $0 == row?.branch ? nil : $0 } }

    var body: some View {
        SheetScaffold(title: String(localized: "task branch"), kicker: String(localized: "branch"), error: error,
                      primary: PrimaryBar(label: String(localized: "set branch"), enabled: next != nil, busy: busy, identifier: "branchConfirm") { Task { await save() } }) {
            FormSection(label: String(localized: "branch")) {
                FieldBox { TextField("branch name", text: $branch).submitLabel(.done).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    .accessibilityIdentifier("branchField")
                Hint(text: String(localized: "Type a new name, or tap a local branch. Renames with git branch -m once the worktree exists."))
            }
            FormSection(label: String(localized: "local branches"), trailing: branches.isEmpty ? nil : "\(branches.count)") {
                if loading {
                    BrailleSpinner(size: 13)
                } else if let listError {
                    ErrorLine(text: listError)
                } else if branches.isEmpty {
                    EmptyState(title: String(localized: "no local branches"), detail: String(localized: "the repo reports none"))
                } else {
                    LazyVStack(spacing: 6) { ForEach(branches, id: \.self) { tile($0) } }
                }
            }
        }
        .task { await load() }
    }

    private func tile(_ name: String) -> some View {
        let on = name == branch.trimmingCharacters(in: .whitespaces)
        return Button { withAnimation(Theme.spring) { branch = name } } label: {
            HStack(spacing: 8) {
                Text(name).font(Theme.mono(13, on ? .semibold : .regular)).foregroundStyle(on ? Theme.accent : Theme.ink)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                if name == row?.branch { Text("this task").font(Theme.mono(11)).foregroundStyle(Theme.muted) }
                else if name == current { Text("checked out").font(Theme.mono(11)).foregroundStyle(Theme.muted) }
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44)
            .selectableTile(on)
        }
        .buttonStyle(.pressable)
    }

    private func load() async {
        if !seeded { branch = row?.branch ?? ""; seeded = true }
        defer { loading = false }
        guard let repo = row?.repo, !repo.isEmpty else { listError = String(localized: "no project path for this task"); return }
        do {
            let r = try await model.client.request("repo.branches", ["repo": repo], as: BranchesResult.self)
            branches = r.branches
            current = r.current
        } catch { listError = error.localizedDescription }
    }

    private func save() async {
        guard let next else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await model.client.request("task.setBranch", ["taskId": taskId, "branch": next], as: EmptyResult.self)
            await host.didMutate(taskId)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// `task.setCommand` with an engine id; reuses `EnginePicker`.
struct EngineSheet: View {
    var host: TaskActionHost
    let taskId: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var engines: [Engine] = []
    @State private var engine = ""
    @State private var initial = ""
    @State private var loading = true
    @State private var error: String?
    @State private var busy = false

    private var ready: Bool { !engine.isEmpty && engine != initial }

    var body: some View {
        SheetScaffold(title: String(localized: "change engine"), kicker: String(localized: "engine"), error: error,
                      primary: PrimaryBar(label: String(localized: "change engine"), enabled: ready, busy: busy, identifier: "engineConfirm") { Task { await save() } }) {
            FormSection(label: String(localized: "engine"), trailing: engines.first { $0.id == initial }.map { String(localized: "now \($0.name.lowercased())") }) {
                if loading { BrailleSpinner(size: 13) } else if engines.isEmpty {
                    EmptyState(title: String(localized: "no engines"), detail: String(localized: "the bridge lists none"))
                } else { EnginePicker(engines: engines, selection: $engine) }
            }
            Hint(text: String(localized: "Takes effect the next time the session is rebuilt. A tab that is running keeps its current engine until then."))
        }
        .presentationDetents([.medium])
        .task { await load() }
    }

    private func load() async {
        defer { loading = false }
        do {
            engines = try await model.client.request("engines.list", as: EnginesResult.self).engines
            let detail = try? await host.fetchDetail(taskId)
            let now = TaskActionLogic.engine(detail: detail, rowEngineId: model.store.task(id: taskId)?.engine?.id, in: engines)
            initial = now?.id ?? ""
            engine = initial
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await model.client.request("task.setCommand", ["taskId": taskId, "engine": engine], as: EmptyResult.self)
            await host.didMutate(taskId)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// `task.setModel` (free text, engine suggestions) and `task.setEffort` (the engine's own levels).
struct ModelEffortSheet: View {
    var host: TaskActionHost
    let taskId: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var engine: Engine?
    @State private var modelText = ""
    @State private var initialModel = ""
    @State private var effort = ""
    @State private var initialEffort = ""
    @State private var loading = true
    @State private var error: String?
    @State private var busy = false

    private var suggestions: [EngineModel] { TaskActionLogic.modelSuggestions(engine) }
    private var levels: [String] { TaskActionLogic.effortLevels(engine) }
    private var modelChange: String? {
        let m = modelText.trimmingCharacters(in: .whitespacesAndNewlines)
        return m.isEmpty || m == initialModel ? nil : m
    }
    private var effortChange: String? { effort.isEmpty || effort == initialEffort ? nil : effort }

    var body: some View {
        SheetScaffold(title: String(localized: "model & effort"), kicker: engine.map { $0.name.lowercased() } ?? String(localized: "engine"), error: error,
                      primary: PrimaryBar(label: String(localized: "save"), enabled: modelChange != nil || effortChange != nil, busy: busy,
                                          identifier: "modelEffortConfirm") { Task { await save() } }) {
            if loading {
                BrailleSpinner(size: 13)
            } else {
                FormSection(label: String(localized: "model"), trailing: initialModel.isEmpty ? String(localized: "engine default") : nil) {
                    FieldBox { TextField("model, in the engine's own spelling", text: $modelText).submitLabel(.done).textInputAutocapitalization(.never).autocorrectionDisabled() }
                        .accessibilityIdentifier("modelField")
                    if suggestions.isEmpty {
                        Hint(text: String(localized: "This engine lists no models. Type one exactly as the engine expects it."))
                    } else {
                        ScrollView(.horizontal, showsIndicators: false) {
                            ChoiceTiles(options: suggestions.map(\.id), selection: $modelText, label: { id in
                                suggestions.first { $0.id == id }.map { $0.name ?? $0.id } ?? id
                            }, fill: false)
                        }
                        .accessibilityIdentifier("modelSuggestions")
                    }
                }
                if !levels.isEmpty {
                    FormSection(label: String(localized: "effort"), trailing: initialEffort.isEmpty ? String(localized: "engine default") : nil) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            ChoiceTiles(options: levels, selection: $effort, label: { $0 }, fill: false)
                        }
                        .accessibilityIdentifier("effortLevels")
                    }
                }
                Hint(text: String(localized: "Both take effect on the next session rebuild."))
            }
        }
        .task { await load() }
    }

    private func load() async {
        defer { loading = false }
        do {
            async let engines = model.client.request("engines.list", as: EnginesResult.self)
            let detail = try await host.fetchDetail(taskId)
            engine = TaskActionLogic.engine(detail: detail, rowEngineId: model.store.task(id: taskId)?.engine?.id,
                                            in: try await engines.engines)
            modelText = detail.model ?? ""; initialModel = modelText
            effort = detail.effort ?? ""; initialEffort = effort
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            if let m = modelChange {
                _ = try await model.client.request("task.setModel", ["taskId": taskId, "model": m], as: EmptyResult.self)
                initialModel = m
            }
            if let level = effortChange {
                _ = try await model.client.request("task.setEffort", ["taskId": taskId, "level": level], as: EmptyResult.self)
                initialEffort = level
            }
            await host.didMutate(taskId)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            await host.didMutate(taskId)
        }
    }
}

/// `task.setStatus`: the six lifecycle labels, current marked. A label only — nothing is stopped.
struct StatusSheet: View {
    var host: TaskActionHost
    let taskId: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var selection: TaskStatusLabel?
    @State private var seeded = false
    @State private var error: String?
    @State private var busy = false

    private var current: TaskStatusLabel? { model.store.task(id: taskId).flatMap { TaskActionLogic.statusLabel($0.status) } }
    private var ready: Bool { selection != nil && selection != current }

    var body: some View {
        SheetScaffold(title: String(localized: "set status"), kicker: String(localized: "status"), error: error,
                      primary: PrimaryBar(label: String(localized: "set status"), enabled: ready, busy: busy, identifier: "statusConfirm") { Task { await save() } }) {
            VStack(spacing: 6) {
                ForEach(TaskStatusLabel.allCases) { label in
                    let on = selection == label
                    Button { withAnimation(Theme.spring) { selection = label } } label: {
                        HStack {
                            Text(label.label).font(Theme.mono(14, on ? .semibold : .regular)).foregroundStyle(on ? Theme.accent : Theme.ink)
                            Spacer()
                            if label == current { Text("current").font(Theme.mono(11)).foregroundStyle(Theme.muted) }
                        }
                        .padding(.horizontal, 14)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .selectableTile(on)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityIdentifier("status-\(label.rawValue)")
                }
            }
            Hint(text: String(localized: "A label only: the worktree, branch and session stay as they are. Canceled stops nothing; delete the task to end it."))
        }
        .onAppear { if !seeded { selection = current; seeded = true } }
    }

    private func save() async {
        guard let selection else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await model.client.request("task.setStatus", ["taskId": taskId, "status": selection.rawValue], as: EmptyResult.self)
            await host.didMutate(taskId)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
