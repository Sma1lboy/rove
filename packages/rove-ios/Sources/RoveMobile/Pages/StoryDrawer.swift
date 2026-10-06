import SwiftUI

struct BoardInputError: LocalizedError {
    var message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// The three editable fields of a story, and what saving them has to send.
/// Compared on trimmed text so a stray newline is not an edit.
struct StoryEdit: Equatable {
    var title: String
    var body: String
    var status: IssueStatus

    init(title: String, body: String, status: IssueStatus) {
        self.title = title; self.body = body; self.status = status
    }

    init(_ story: Story) { self.init(title: story.title, body: story.detail, status: story.status) }

    func titleChanged(from o: StoryEdit) -> Bool { BoardCardLogic.trim(title) != BoardCardLogic.trim(o.title) }
    func bodyChanged(from o: StoryEdit) -> Bool { BoardCardLogic.trim(body) != BoardCardLogic.trim(o.body) }
    func isDirty(from o: StoryEdit) -> Bool { titleChanged(from: o) || bodyChanged(from: o) || status != o.status }

    /// A changed title must not be empty; an untouched one never blocks.
    func canSubmit(from o: StoryEdit) -> Bool {
        isDirty(from: o) && (!titleChanged(from: o) || !BoardCardLogic.trim(title).isEmpty)
    }

    /// `issue.update` args for the title and description, nil when neither changed. An emptied
    /// description is `clearBody`: the bridge refuses an empty `body`.
    func updateArgs(repo: String, id: Int, from o: StoryEdit) -> [String: Any]? {
        guard titleChanged(from: o) || bodyChanged(from: o) else { return nil }
        var args: [String: Any] = ["repo": repo, "id": id]
        if titleChanged(from: o) { args["title"] = BoardCardLogic.trim(title) }
        if bodyChanged(from: o) {
            let text = BoardCardLogic.trim(body)
            if text.isEmpty { args["clearBody"] = true } else { args["body"] = text }
        }
        return args
    }
}

/// The EVENTS snapshot rows: `  3m  tool-start · Bash · claude`.
enum EventRowFormat {
    /// `TaskListLogic.age` of now minus the event, right-aligned to four characters.
    static func age(at: Double, now: Date) -> String {
        guard at > 0 else { return pad("—") }
        return pad(TaskListLogic.age(ms: max(0, now.timeIntervalSince1970 * 1000 - at)))
    }

    static func pad(_ s: String) -> String { String(repeating: " ", count: max(0, 4 - s.count)) + s }
}

private enum EventsState {
    case loading
    case loaded([TaskEvent], Date)
    case failed(String)
}

/// Story drawer: edit title, description and status; for a linked story its task and recent
/// events; start a session; delete the record.
struct StoryDrawer: View {
    let repo: String
    let story: Story
    var onChanged: () async -> Void
    var onStarted: (StartOutcome) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var detail: String
    @State private var status: IssueStatus
    /// What the bridge holds, so a board refresh underneath never moves the baseline.
    @State private var original: StoryEdit
    @State private var busy = false
    @State private var error: String?
    @State private var events: EventsState = .loading
    @State private var showStart = false
    @State private var showDelete = false

    init(repo: String, story: Story, onChanged: @escaping () async -> Void,
         onStarted: @escaping (StartOutcome) -> Void) {
        self.repo = repo
        self.story = story
        self.onChanged = onChanged
        self.onStarted = onStarted
        _title = State(initialValue: story.title)
        _detail = State(initialValue: story.detail)
        _status = State(initialValue: story.status)
        _original = State(initialValue: StoryEdit(story))
    }

    private var edit: StoryEdit { StoryEdit(title: title, body: detail, status: status) }

    var body: some View {
        SheetScaffold(title: String(localized: "story #\(story.id)"), kicker: URL(fileURLWithPath: repo).lastPathComponent, error: error,
                      primary: PrimaryBar(label: String(localized: "save"), enabled: edit.canSubmit(from: original), busy: busy,
                                          identifier: "drawerSave") { Task { await save() } }) {
            FormSection(label: String(localized: "title")) {
                FieldBox {
                    TextField("", text: $title, prompt: Text("what to do").foregroundStyle(Theme.muted))
                        .accessibilityIdentifier("drawerTitle")
                }
            }
            FormSection(label: String(localized: "description")) {
                PromptEditor(text: $detail, placeholder: String(localized: "what and why, in a few lines"))
                    .accessibilityIdentifier("drawerDescription")
            }
            FormSection(label: String(localized: "status")) {
                ChoiceTiles(options: IssueStatus.allCases, selection: $status, label: { $0.rawValue })
                    .accessibilityIdentifier("drawerStatus")
            }
            if let taskId = story.taskId {
                linkedTask(taskId)
                eventsSection
            }
            startButton
            FormSection(label: String(localized: "delete story")) {
                ActionRow(title: String(localized: "delete story"), detail: String(localized: "record only"),
                          tint: Theme.error) { showDelete = true }
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                    .tile()
                    .accessibilityIdentifier("deleteStory")
            }
        }
        .task { await loadEvents() }
        .sheet(isPresented: $showStart) {
            StartSessionSheet(repo: repo, story: story, unsaved: edit.isDirty(from: original),
                              saveEdits: persistEdits, finished: started)
        }
        .sheet(isPresented: $showDelete) {
            DeleteStorySheet(repo: repo, story: story, deleted: deleted)
        }
    }

    // MARK: Linked task and events

    private func linkedTask(_ id: String) -> some View {
        let task = model.store.task(id: id)
        return FormSection(label: String(localized: "task")) {
            VStack(spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(task?.displayTitle ?? String(localized: "linked task")).font(Theme.face(15, .semibold))
                            .foregroundStyle(Theme.ink).lineLimit(2)
                        if task == nil {
                            Text(model.store.loaded ? String(localized: "not in the task list") : String(localized: "waiting for the task list"))
                                .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        }
                    }
                    Spacer(minLength: 8)
                    if let task { StatusTag(group: task.group) }
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                if let task {
                    Rectangle().fill(Theme.line).frame(height: 1)
                    ActionRow(title: String(localized: "open task"), detail: task.engine?.name.lowercased()) { openTask(task.id) }
                        .accessibilityIdentifier("openTask")
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .tile()
        }
    }

    private var eventsSection: some View {
        FormSection(label: String(localized: "events")) {
            switch events {
            case .loading:
                BrailleSpinner(size: 13)
            case .failed(let message):
                ErrorLine(text: message)
            case .loaded(let rows, let at):
                if rows.isEmpty {
                    EmptyState(title: String(localized: "no events recorded"),
                               detail: String(localized: "the daemon forgets them when it restarts"))
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in eventLine(row, now: at) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .tile()
                    .accessibilityIdentifier("drawerEvents")
                }
            }
        }
    }

    private func eventLine(_ row: TaskEvent, now: Date) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(EventRowFormat.age(at: row.at, now: now)).font(Theme.mono(12)).foregroundStyle(Theme.muted)
            Text(row.kind).font(Theme.mono(12)).foregroundStyle(Theme.ink).lineLimit(1)
            if !row.tail.isEmpty {
                Text(verbatim: "· \(row.tail)").font(Theme.mono(12)).foregroundStyle(Theme.muted).lineLimit(1)
            }
        }
    }

    private var startButton: some View {
        Button { showStart = true } label: {
            HStack(spacing: 12) {
                Text(story.linked ? String(localized: "start another session") : String(localized: "start session"))
                    .font(Theme.mono(15, .medium)).foregroundStyle(Theme.accent)
                Spacer()
                Text("→").font(Theme.mono(15, .medium)).foregroundStyle(Theme.accent)
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            .tile()
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier("startSession")
    }

    // MARK: Actions

    private func loadEvents() async {
        guard let id = story.taskId else { return }
        do {
            let result = try await model.client.request("task.events", ["taskId": id], as: TaskEventsResult.self)
            events = .loaded(result.events, Date())
        } catch { events = .failed(error.localizedDescription) }
    }

    private func openTask(_ id: String) {
        dismiss()
        model.path.append(.task(id))
    }

    /// Title and description via `issue.update`; the baseline moves only once the bridge accepted it.
    private func persistEdits() async throws {
        let now = edit
        if now.titleChanged(from: original), BoardCardLogic.trim(now.title).isEmpty {
            throw BoardInputError(String(localized: "the title is empty"))
        }
        guard let args = now.updateArgs(repo: repo, id: story.id, from: original) else { return }
        _ = try await model.client.request("issue.update", args, as: EmptyResult.self)
        original.title = now.title
        original.body = now.body
    }

    /// `issue.update` for what changed, then `issue.setStatus` if the status did; reloads the board and closes.
    private func save() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await persistEdits()
            if status != original.status {
                _ = try await model.client.request(
                    "issue.setStatus", ["repo": repo, "id": story.id, "status": status.rawValue], as: EmptyResult.self)
                original.status = status
            }
            await onChanged()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            // The first step may have landed before the second failed.
            await onChanged()
        }
    }

    /// Dismissing the drawer takes the start sheet with it.
    private func started(_ outcome: StartOutcome) {
        dismiss()
        onStarted(outcome)
    }

    private func deleted() {
        dismiss()
        Task { await onChanged() }
    }
}

/// `issue.delete`: states what is and is not removed before anything changes.
struct DeleteStorySheet: View {
    let repo: String
    let story: Story
    var deleted: () -> Void
    @Environment(AppModel.self) private var model
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        SheetScaffold(title: String(localized: "delete this story?"), kicker: "#\(story.id)", error: error,
                      primary: PrimaryBar(label: String(localized: "delete story"), destructive: true, busy: busy,
                                          identifier: "confirmDeleteStory") { Task { await run() } }) {
            Text("Removes only the story record. A linked task, its branch and its worktree are left alone.")
                .font(Theme.face(16)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .presentationDetents([.medium])
    }

    private func run() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try await model.client.request("issue.delete", ["repo": repo, "id": story.id], as: EmptyResult.self)
            deleted()
        } catch { self.error = error.localizedDescription }
    }
}
