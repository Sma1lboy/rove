import SwiftUI

struct NewTaskView: View {
    var onCreated: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var repos: [String] = []
    @State private var engines: [Engine] = []
    @State private var repo = ""
    @State private var engine = ""
    @State private var title = ""
    @State private var prompt = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Repository") {
                    Picker("Repo", selection: $repo) {
                        ForEach(repos, id: \.self) { Text(URL(fileURLWithPath: $0).lastPathComponent).tag($0) }
                    }
                }
                Section("Engine") {
                    Picker("Engine", selection: $engine) {
                        ForEach(engines) { Text($0.name).tag($0.id) }
                    }.accessibilityIdentifier("enginePicker")
                }
                Section("Title (optional)") { TextField("Title", text: $title).accessibilityIdentifier("titleField") }
                Section("First prompt") {
                    TextEditor(text: $prompt).frame(minHeight: 120).accessibilityIdentifier("promptEditor")
                }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            }
            .keyboardDoneButton()
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }.disabled(busy || repo.isEmpty).accessibilityIdentifier("createButton")
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            repos = try await model.client.request("repos.list", as: ReposResult.self).repos
            engines = try await model.client.request("engines.list", as: EnginesResult.self).engines
            if repo.isEmpty { repo = model.store.repoFilter.flatMap { repos.contains($0) ? $0 : nil } ?? repos.first ?? "" }
            if engine.isEmpty { engine = engines.first?.id ?? "" }
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
            dismiss()
            onCreated(r.taskId)
        } catch { self.error = error.localizedDescription }
    }
}
