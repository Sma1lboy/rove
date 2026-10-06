import SwiftUI

/// Presets for the new-session sheet (`ctrl+a c` = continue in a tab, `ctrl+a f` = fork a child task).
struct SessionPreset: Equatable {
    var destination: SessionDestination = .tab
    var context: SessionContext = .fresh
    /// Reopening a task whose tabs were all closed: a tab only, engine of the task.
    var reopen = false
}

/// What the task detail's `…` menu can open from here.
enum TabSheetRoute: Identifiable, Equatable {
    case newSession(SessionPreset)
    case rename(TabRow)
    case askPR

    var id: String {
        switch self {
        case .newSession(let p): "new-\(p.destination.rawValue)-\(p.context.rawValue)-\(p.reopen)"
        case .rename(let t): "rename-\(t.id)"
        case .askPR: "pr"
        }
    }

    var isSheet: Bool { self != .askPR }
}

extension View {
    /// Sheets and the PR confirmation for the tab actions. `opened` receives a freshly opened tab's id.
    func tabSheets(_ route: Binding<TabSheetRoute?>, taskId: String, row: TaskRow?, sourceTab: TabRow?, session: TerminalSession?,
                   opened: @escaping (String) async -> Void) -> some View {
        modifier(TabSheetsModifier(route: route, taskId: taskId, row: row, sourceTab: sourceTab, session: session, opened: opened))
    }
}

private struct TabSheetsModifier: ViewModifier {
    @Binding var route: TabSheetRoute?
    let taskId: String
    let row: TaskRow?
    let sourceTab: TabRow?
    let session: TerminalSession?
    let opened: (String) async -> Void
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        content
            .sheet(item: Binding(get: { route?.isSheet == true ? route : nil }, set: { if $0 == nil { route = nil } })) { r in
                switch r {
                case .newSession(let preset):
                    NewSessionSheet(taskId: taskId, row: row, sourceTabId: sourceTab?.id ?? "tab-1", preset: preset, opened: opened)
                case .rename(let tab):
                    RenameTabSheet(taskId: taskId, tab: tab) { await opened(tab.id) }
                case .askPR:
                    EmptyView()
                }
            }
            .confirmationDialog("Ask the engine to open a PR?", isPresented: Binding(get: { route == .askPR }, set: { if !$0 { route = nil } }),
                                titleVisibility: .visible) {
                Button("Send PR request") { Task { await askForPR() } }
            } message: {
                Text("Sends this repo's PR instructions to the tab. The engine commits, pushes to origin and opens the PR.")
            }
    }

    private func askForPR() async {
        var args: [String: Any] = ["taskId": taskId]
        if let tab = sourceTab { args["tabId"] = tab.id }
        do {
            _ = try await model.client.request("tab.requestPR", args, as: EmptyResult.self)
            session?.flash(String(localized: "pr request sent"))
        } catch { session?.flash(error.localizedDescription) }
    }
}

/// The tab actions in the task detail's `…` menu.
struct TabActionItems: View {
    var tab: TabRow?
    var session: TerminalSession?
    @Binding var route: TabSheetRoute?
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { route = .newSession(SessionPreset()) } label: { Label("New session…", systemImage: "plus") }
        if tab != nil {
            Button { route = .newSession(SessionPreset(context: .continued)) } label: { Label("Continue in a new tab…", systemImage: "arrow.turn.down.right") }
            Button { route = .newSession(SessionPreset(destination: .fork)) } label: { Label("Fork a child task…", systemImage: "arrow.triangle.branch") }
            Button { if let tab { route = .rename(tab) } } label: { Label("Rename tab", systemImage: "pencil") }
            Button { Task { await session?.interrupt() } } label: { Label("Interrupt turn", systemImage: "stop.circle") }
                .disabled(session == nil)
            Button { route = .askPR } label: { Label("Ask the engine for a PR…", systemImage: "arrow.up.right.square") }
        }
        Button { model.openNextPending() } label: { Label("Next waiting item", systemImage: "bell") }
            .disabled(model.store.attention.allSatisfy { $0.taskId == nil })
    }
}

/// `rove api rename --tab`: the name the tab strip shows.
struct RenameTabSheet: View {
    let taskId: String
    let tab: TabRow
    var done: () async -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var error: String?
    @State private var busy = false

    private var ready: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !title.contains("\n") }

    var body: some View {
        SheetScaffold(title: String(localized: "rename tab"), kicker: tab.id, error: error,
                      primary: PrimaryBar(label: String(localized: "rename"), enabled: ready, busy: busy, identifier: "rename") { Task { await rename() } }) {
            FormSection(label: String(localized: "name")) {
                FieldBox {
                    TextField("", text: $title, prompt: Text(tab.displayTitle.lowercased()).foregroundStyle(Theme.muted))
                        .submitLabel(.done)
                        .onSubmit { if ready { Task { await rename() } } }
                        .accessibilityIdentifier("renameField")
                }
            }
            Hint(text: String(localized: "Shown in the tab strip here and on the desktop."))
        }
        .presentationDetents([.medium])
        .onAppear { title = tab.title ?? "" }
    }

    private func rename() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await model.client.request("tab.rename", ["taskId": taskId, "tabId": tab.id, "title": title.trimmingCharacters(in: .whitespacesAndNewlines)], as: EmptyResult.self)
            await done()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// `ctrl+e`: the one dialog for starting anything. Destination (this worktree ⇄ a child task), context
/// (fresh ⇄ continue this conversation), engine, attempts. Shell tabs and plugin panes are desktop-only.
struct NewSessionSheet: View {
    let taskId: String
    let row: TaskRow?
    let sourceTabId: String
    let preset: SessionPreset
    var opened: (String) async -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var engines: [Engine] = []
    @State private var engine = ""
    @State private var destination: SessionDestination = .tab
    @State private var context: SessionContext = .fresh
    @State private var attempts = 1
    @State private var message = ""
    @State private var handoff: HandoffAnswer?
    @State private var loadingHandoff = false
    @State private var error: String?
    @State private var busy = false

    private var request: NewSessionLogic.Request? {
        NewSessionLogic.request(destination: destination, context: context, engine: engine, message: message, handoff: handoff,
                                attempts: attempts, repo: row?.repo ?? "", branch: row?.branch ?? "")
    }
    private var handoffRefusal: String? { context == .continued ? handoff.flatMap(NewSessionLogic.refusal) : nil }
    private var canFork: Bool { !(row?.branch.isEmpty ?? true) && !preset.reopen }

    var body: some View {
        SheetScaffold(title: title, kicker: destination == .tab ? String(localized: "same worktree") : String(localized: "new worktree"), error: error,
                      primary: PrimaryBar(label: primaryLabel, enabled: request != nil, busy: busy || loadingHandoff,
                                          identifier: "startSessionButton") { Task { await start() } }) {
            if !preset.reopen {
                FormSection(label: String(localized: "where")) {
                    ChoiceTiles(options: canFork ? SessionDestination.allCases : [.tab], selection: $destination,
                                label: { $0 == .tab ? String(localized: "new tab here") : String(localized: "fork child task") })
                }
            }
            FormSection(label: String(localized: "engine")) {
                if engines.isEmpty { BrailleSpinner(size: 13) } else { EnginePicker(engines: engines, selection: $engine) }
            }
            FormSection(label: String(localized: "conversation")) {
                ChoiceTiles(options: SessionContext.allCases, selection: $context,
                            label: { $0 == .fresh ? String(localized: "fresh") : String(localized: "continue this one") })
                if let why = handoffRefusal { Text(why).font(Theme.mono(12)).foregroundStyle(Theme.muted) }
            }
            if destination == .fork {
                FormSection(label: String(localized: "attempts"), trailing: attempts > 1 ? String(localized: "same prompt, \(attempts) siblings") : nil) {
                    ChoiceTiles(options: Array(1...NewSessionLogic.maxAttempts), selection: $attempts, label: { "\($0)" })
                }
            }
            FormSection(label: context == .continued ? String(localized: "your message (optional)") : String(localized: "first message")) {
                PromptEditor(text: $message, placeholder: String(localized: "what should this session work on"))
            }
            Hint(text: hint)
        }
        .task { await loadEngines() }
        .task(id: context) { await loadHandoff() }
        .onAppear { destination = preset.destination; context = preset.context }
    }

    private var title: String { preset.reopen ? String(localized: "reopen session") : String(localized: "new session") }

    private var primaryLabel: String {
        switch (destination, attempts) {
        case (.tab, _): preset.reopen ? String(localized: "reopen") : String(localized: "open tab")
        case (.fork, 1): String(localized: "fork task")
        case (.fork, let n): String(localized: "start \(n) attempts")
        }
    }

    private var hint: String {
        var lines: [String] = []
        switch destination {
        case .tab: lines.append(String(localized: "Tabs share the worktree but keep their own process, scrollback and conversation."))
        case .fork:
            let branch = row?.branch ?? String(localized: "this task's branch")
            lines.append(String(localized: "The child branches from \(branch): committed work carries over, uncommitted changes stay behind."))
        }
        if context == .continued {
            lines.append(String(localized: "Continue hands the new session this conversation's transcript. A native fork needs the desktop, so even the same engine gets a handoff here."))
        }
        lines.append(String(localized: "Shell tabs and plugin panes need a desktop terminal, so the phone starts engines only."))
        return lines.joined(separator: " ")
    }

    private func loadEngines() async {
        do {
            engines = try await model.client.request("engines.list", as: EnginesResult.self).engines
            if engine.isEmpty { engine = row?.engine?.id.flatMap { id in engines.contains { $0.id == id } ? id : nil } ?? engines.first?.id ?? "" }
        } catch { self.error = error.localizedDescription }
    }

    /// The transcript brief, fetched once when "continue" is picked.
    private func loadHandoff() async {
        guard context == .continued, handoff == nil else { return }
        loadingHandoff = true
        defer { loadingHandoff = false }
        do {
            handoff = try await model.client.request("tab.handoff", ["taskId": taskId, "tabId": sourceTabId], as: HandoffAnswer.self)
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func start() async {
        guard let request else { return }
        busy = true
        defer { busy = false }
        do {
            switch request {
            case .tab(let prompt, let engine):
                var args: [String: Any] = ["taskId": taskId, "prompt": prompt]
                if let engine { args["engine"] = engine }
                let tab = try await model.client.request("tab.new", args, as: TabNewResult.self)
                await opened(tab.tabId)
                dismiss()
            case .fork(let repo, let branch, let prompt, let engine, let count):
                var args: [String: Any] = ["repo": repo, "baseBranch": branch, "prompt": prompt, "count": count]
                if let engine { args["engine"] = engine }
                let ids = try await model.client.request("tab.forkTask", args, as: ForkTaskResult.self).taskIds
                await model.store.refresh()
                dismiss()
                // A single attempt is "carry on from here" and moves you; a round stays put.
                if let only = ids.first, ids.count == 1 { model.path.append(.task(only)) }
                else { model.inbox.show(Notice(title: String(localized: "\(ids.count) attempts started"), body: row?.displayTitle, kind: "done", at: Date().timeIntervalSince1970 * 1000)) }
            }
        } catch { self.error = error.localizedDescription }
    }
}
