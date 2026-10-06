import SwiftUI

/// Where a story's session runs.
enum StartPlacement: String, CaseIterable, Hashable {
    case worktree, project

    var label: String { rawValue }

    var hint: String {
        switch self {
        case .worktree: "the story's own worktree and branch"
        case .project: "a new tab on the project checkout, no worktree"
        }
    }
}

/// What the app does once the session started.
enum StartFollow: String, CaseIterable, Hashable {
    case follow, stay

    var label: String { self == .follow ? "follow" : "stay on board" }

    var hint: String {
        switch self {
        case .follow: "open the session as soon as it starts"
        case .stay: "back on the board while it works"
        }
    }
}

/// What a finished start hands back to the board.
struct StartOutcome: Equatable {
    var storyId: Int
    /// The task to open on follow: the story's new task, or the project's main task.
    var openTaskId: String
    var follow: Bool
    /// Best-effort steps that failed after the session had already started.
    var warnings: [String]
}

/// The TUI's "start session" as bridge atoms. A failure before the session exists throws;
/// the link and status steps afterwards are best-effort and report into `warnings`.
@MainActor
struct SessionStarter {
    let client: BridgeClient

    func start(repo: String, story: Story, engine: String, placement: StartPlacement, follow: Bool) async throws -> StartOutcome {
        let id = story.id
        let drafted = try await client.request("issue.prompt", ["repo": repo, "id": id, "where": placement.rawValue],
                                               as: IssuePromptResult.self)
        var warnings: [String] = []
        let openTaskId: String
        switch placement {
        case .worktree:
            var args: [String: Any] = ["repo": repo, "prompt": drafted.prompt, "title": drafted.title]
            if !engine.isEmpty { args["engine"] = engine }
            let created = try await client.request("task.create", args, as: TaskCreateResult.self)
            openTaskId = created.taskId
            await attempt("could not link #\(id) to its task", &warnings) {
                _ = try await client.request("issue.update", ["repo": repo, "id": id, "task": created.taskId],
                                             as: EmptyResult.self)
            }
        case .project:
            let main = try await client.request("project.ensureMain", ["repo": repo], as: EnsureMainResult.self)
            var args: [String: Any] = ["taskId": main.taskId, "prompt": drafted.prompt]
            if !engine.isEmpty { args["engine"] = engine }
            _ = try await client.request("tab.new", args, as: TabNewResult.self)
            openTaskId = main.taskId
        }
        await attempt("could not mark #\(id) doing", &warnings) {
            _ = try await client.request("issue.setStatus", ["repo": repo, "id": id, "status": IssueStatus.doing.rawValue],
                                         as: EmptyResult.self)
        }
        return StartOutcome(storyId: id, openTaskId: openTaskId, follow: follow, warnings: warnings)
    }

    private func attempt(_ what: String, _ warnings: inout [String], _ step: () async throws -> Void) async {
        do { try await step() } catch { warnings.append("\(what): \(error.localizedDescription)") }
    }
}

/// Engine, where and after for one story session. Choices are remembered on this phone.
struct StartSessionSheet: View {
    let repo: String
    let story: Story
    /// The drawer's edits are written first so the prompt is built from what is on screen.
    var unsaved = false
    var saveEdits: () async throws -> Void
    var finished: (StartOutcome) -> Void
    @Environment(AppModel.self) private var model
    @AppStorage("board.start.engine") private var lastEngine = ""
    @AppStorage("board.start.where") private var whereRaw = StartPlacement.worktree.rawValue
    @AppStorage("board.start.after") private var afterRaw = StartFollow.follow.rawValue
    @State private var engines: [Engine] = []
    @State private var engine = ""
    @State private var loading = true
    @State private var busy = false
    @State private var error: String?

    private var placement: Binding<StartPlacement> {
        Binding(get: { StartPlacement(rawValue: whereRaw) ?? .worktree }, set: { whereRaw = $0.rawValue })
    }

    private var after: Binding<StartFollow> {
        Binding(get: { StartFollow(rawValue: afterRaw) ?? .follow }, set: { afterRaw = $0.rawValue })
    }

    private var label: String { story.linked ? "start another session" : "start session" }

    var body: some View {
        SheetScaffold(title: label, kicker: "#\(story.id)", error: error,
                      primary: PrimaryBar(label: label, enabled: !loading, busy: busy,
                                          identifier: "startSessionSubmit") { Task { await submit() } }) {
            Text(story.title).font(Theme.face(16)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            FormSection(label: "engine") {
                if loading {
                    BrailleSpinner(size: 13)
                } else if engines.isEmpty {
                    Hint(text: "no engines found, the daemon picks its default")
                } else {
                    EnginePicker(engines: engines, selection: $engine)
                }
            }
            FormSection(label: "where") {
                ChoiceTiles(options: StartPlacement.allCases, selection: placement, label: { $0.label })
                    .accessibilityIdentifier("startWhere")
                Hint(text: placement.wrappedValue.hint)
            }
            FormSection(label: "after") {
                ChoiceTiles(options: StartFollow.allCases, selection: after, label: { $0.label })
                    .accessibilityIdentifier("startAfter")
                Hint(text: after.wrappedValue.hint)
            }
            if unsaved { Hint(text: "Unsaved edits to the story are saved first.") }
        }
        .task { await load() }
    }

    private func load() async {
        defer { loading = false }
        do {
            engines = try await model.client.request("engines.list", as: EnginesResult.self).engines
            if engine.isEmpty { engine = engines.contains { $0.id == lastEngine } ? lastEngine : engines.first?.id ?? "" }
        } catch { self.error = error.localizedDescription }
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await saveEdits()
            let outcome = try await SessionStarter(client: model.client)
                .start(repo: repo, story: story, engine: engine, placement: placement.wrappedValue,
                       follow: after.wrappedValue == .follow)
            lastEngine = engine
            finished(outcome)
        } catch { self.error = error.localizedDescription }
    }
}
