import SwiftUI

/// `rove api add`: repo, engine, optional title and first prompt. The last repo and engine
/// are remembered on this phone, as the TUI's dialog remembers its own.
struct NewTaskView: View {
    var onCreated: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage("newTask.repo") private var lastRepo = ""
    @AppStorage("newTask.engine") private var lastEngine = ""
    @State private var repos: [String] = []
    @State private var engines: [Engine] = []
    @State private var repo = ""
    @State private var engine = ""
    @State private var title = ""
    @State private var prompt = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        SheetScaffold(title: "new task", kicker: "worktree + branch", error: error,
                      primary: PrimaryBar(label: "create task", enabled: !repo.isEmpty, busy: busy,
                                          identifier: "createButton") { Task { await create() } }) {
            FormSection(label: "repository", trailing: repos.isEmpty ? nil : String(format: "%02d", repos.count)) {
                if repos.isEmpty && error == nil { BrailleSpinner(size: 13) }
                VStack(spacing: 6) {
                    ForEach(repos, id: \.self) { path in repoRow(path) }
                }
            }
            FormSection(label: "engine") {
                if !engines.isEmpty { EnginePicker(engines: engines, selection: $engine) }
            }
            FormSection(label: "title") {
                FieldBox {
                    TextField("", text: $title, prompt: Text("optional — derived from the prompt").foregroundStyle(Theme.muted))
                        .accessibilityIdentifier("titleField")
                }
            }
            FormSection(label: "first prompt") {
                PromptEditor(text: $prompt, placeholder: "leave empty to open the worktree without starting the engine")
                    .accessibilityIdentifier("promptEditor")
            }
        }
        .task { await load() }
    }

    private func repoRow(_ path: String) -> some View {
        let on = path == repo
        return Button { withAnimation(Theme.spring) { repo = path } } label: {
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

    private func load() async {
        do {
            repos = try await model.client.request("repos.list", as: ReposResult.self).repos
            engines = try await model.client.request("engines.list", as: EnginesResult.self).engines
            let preferred = [model.store.repoFilter, lastRepo].compactMap { $0 }.first { repos.contains($0) }
            if repo.isEmpty { repo = preferred ?? repos.first ?? "" }
            if engine.isEmpty { engine = engines.contains { $0.id == lastEngine } ? lastEngine : engines.first?.id ?? "" }
        } catch { self.error = error.localizedDescription }
    }

    private func create() async {
        busy = true; defer { busy = false }
        var args: [String: Any] = ["repo": repo]
        if !engine.isEmpty { args["engine"] = engine }
        if !title.trimmingCharacters(in: .whitespaces).isEmpty { args["title"] = title }
        if !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { args["prompt"] = prompt }
        do {
            let r = try await model.client.request("task.create", args, as: TaskCreateResult.self)
            lastRepo = repo
            lastEngine = engine
            dismiss()
            onCreated(r.taskId)
        } catch { self.error = error.localizedDescription }
    }
}
