import SwiftUI

struct TaskDetailView: View {
    let taskId: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var tabs: [TabRow] = []
    @State private var error: String?
    @State private var newTab = false
    @State private var closing: TabRow?
    @State private var confirmDelete = false
    @State private var deleteSheet = false
    @State private var confirmLand = false
    @State private var landResult: String?

    private var row: TaskRow? { model.store.task(id: taskId) }
    private var client: BridgeClient { model.client }

    var body: some View {
        List {
            if let row { header(row) } else { Section { Text("Loading task…").foregroundStyle(.secondary) } }
            Section("Terminal tabs") {
                ForEach(tabs) { tab in
                    NavigationLink(value: Route.terminal(taskId: taskId, tab: tab)) { tabRow(tab) }
                        .accessibilityIdentifier("tab-\(tab.id)")
                        .swipeActions { Button("Close", role: .destructive) { closing = tab } }
                }
                if tabs.isEmpty { Text("No tabs").foregroundStyle(.secondary) }
                Button { newTab = true } label: { Label("New engine tab", systemImage: "plus.rectangle.on.rectangle") }
            }
            Section {
                NavigationLink(value: Route.diff(taskId: taskId)) { Label("Diff", systemImage: "plusminus") }
                    .accessibilityIdentifier("diffLink")
                Button { confirmLand = true } label: { Label("Land", systemImage: "arrow.down.to.line") }
                Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                    .accessibilityIdentifier("deleteButton")
            }
            if let error { Section { Text(error).foregroundStyle(.red).font(.footnote) } }
        }
        .navigationTitle(row?.displayTitle ?? "Task")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadTabs() }
        .onChange(of: model.store.version) { Task { await loadTabs() } }
        .sheet(isPresented: $newTab) { NewTabSheet(taskId: taskId) { await loadTabs() } }
        .sheet(isPresented: $deleteSheet) {
            DeleteConfirmSheet(taskId: taskId) { dismiss() }
        }
        .confirmationDialog("Close this tab?", isPresented: Binding(get: { closing != nil }, set: { if !$0 { closing = nil } }),
                            titleVisibility: .visible) {
            Button("Close tab", role: .destructive) { if let t = closing { Task { await close(t) } } }
        }
        .confirmationDialog("Delete this task?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete…", role: .destructive) { deleteSheet = true }
        } message: { Text("Removes the task and its worktree.") }
        .confirmationDialog("Land this task", isPresented: $confirmLand, titleVisibility: .visible) {
            Button("Merge") { Task { await land("merge") } }
            Button("Squash") { Task { await land("squash") } }
        }
        .alert("Landed", isPresented: Binding(get: { landResult != nil }, set: { if !$0 { landResult = nil } })) {
            Button("OK") { landResult = nil }
        } message: { Text(landResult ?? "") }
    }

    private func header(_ row: TaskRow) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(row.displayTitle).font(.title3.weight(.semibold))
                if !row.branch.isEmpty { Label(row.branch, systemImage: "arrow.triangle.branch").font(.subheadline) }
                HStack {
                    Chip(text: row.group.title, color: row.group.color)
                    if let e = row.engine { Text(e.name).font(.caption).foregroundStyle(.secondary) }
                    if let pr = row.pr { PRChip(pr: pr) }
                }
                TimelineView(.periodic(from: .now, by: 15)) { ctx in
                    if let t = model.store.activityText(row, now: ctx.date) {
                        Text(t).font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let r = row.report { Text(r.summary).font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }

    private func tabRow(_ tab: TabRow) -> some View {
        HStack {
            Image(systemName: tab.kind == "engine" ? "sparkles" : "terminal")
            VStack(alignment: .leading) {
                Text(tab.displayTitle)
                Text(tab.kind == "engine" ? (tab.engineName ?? "engine") : tab.kind).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if tab.alive == false { Chip(text: "exited", color: .gray) }
        }
    }

    private func loadTabs() async {
        do { tabs = try await client.request("task.tabs", ["taskId": taskId], as: TabsResult.self).tabs; error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func close(_ tab: TabRow) async {
        closing = nil
        do { _ = try await client.request("tab.close", ["taskId": taskId, "tabId": tab.id], as: EmptyResult.self); await loadTabs() }
        catch { self.error = error.localizedDescription }
    }

    private func land(_ strategy: String) async {
        do {
            let r = try await client.request("task.land", ["taskId": taskId, "strategy": strategy], as: TaskLandResult.self)
            landResult = "Landed on \(r.landedOn) (\(r.commit.prefix(8)))"
        } catch { self.error = error.localizedDescription }
    }
}

struct NewTabSheet: View {
    let taskId: String
    var done: () async -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var engines: [Engine] = []
    @State private var engine = ""
    @State private var prompt = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Engine", selection: $engine) { ForEach(engines) { Text($0.name).tag($0.id) } }
                Section("First message (required)") { TextEditor(text: $prompt).frame(minHeight: 100) }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            }
            .keyboardDoneButton()
            .navigationTitle("New engine tab")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Open") { Task { await create() } }
                        .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .task {
                do {
                    engines = try await model.client.request("engines.list", as: EnginesResult.self).engines
                    if engine.isEmpty { engine = engines.first?.id ?? "" }
                } catch { self.error = error.localizedDescription }
            }
        }
    }

    private func create() async {
        var args: [String: Any] = ["taskId": taskId, "prompt": prompt]
        if !engine.isEmpty { args["engine"] = engine }
        do {
            _ = try await model.client.request("tab.new", args, as: TabNewResult.self)
            await done()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct DeleteConfirmSheet: View {
    let taskId: String
    var deleted: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var force = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { Text("This permanently deletes the task. Are you sure?") }
                Section {
                    Toggle("Force (discard uncommitted changes)", isOn: $force).accessibilityIdentifier("forceToggle")
                }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                Section {
                    Button("Delete task", role: .destructive) { Task { await run() } }.accessibilityIdentifier("confirmDeleteButton")
                }
            }
            .navigationTitle("Confirm delete")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    private func run() async {
        var args: [String: Any] = ["taskId": taskId]
        if force { args["force"] = true }
        do {
            _ = try await model.client.request("task.delete", args, as: TaskDeleteResult.self)
            dismiss()
            deleted()
        } catch { self.error = error.localizedDescription }
    }
}
