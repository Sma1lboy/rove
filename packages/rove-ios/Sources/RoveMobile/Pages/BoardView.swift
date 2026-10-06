import Observation
import SwiftUI

/// Load state of the Kanban board: which projects exist, the selected project's stories, and the
/// one-line notices. A failed refresh keeps the last data and only sets an error.
@MainActor @Observable
final class BoardModel {
    private(set) var projects: [String] = []
    private(set) var projectsLoaded = false
    /// The selected project: an absolute path straight from the repo list (never rewritten).
    private(set) var repo = ""
    private(set) var issues: RepoIssues?
    private(set) var projectsError: String?
    private(set) var issuesError: String?
    /// Best-effort steps of a started session that failed; shown until dismissed.
    var warnings: [String] = []
    private(set) var notice: String?

    @ObservationIgnored private var seq = 0
    @ObservationIgnored private var ticks = 0
    @ObservationIgnored private var noticeSeq = 0

    var error: String? { issuesError ?? projectsError }

    /// One auto-refresh tick (every 5s): the project list is re-read now and then, the stories every time.
    func refresh(client: BridgeClient, preferred: String, force: Bool = false) async {
        if force || projects.isEmpty || ticks % 6 == 0 { await loadProjects(client: client, preferred: preferred) }
        ticks += 1
        await reload(client: client)
    }

    func loadProjects(client: BridgeClient, preferred: String) async {
        var issueRepos: [String] = []
        var known: [String] = []
        var failure: String?
        do { issueRepos = try await client.request("issue.repos", as: IssueReposResult.self).repos }
        catch { failure = error.localizedDescription }
        do { known = try await client.request("repos.list", as: ReposResult.self).repos }
        catch { failure = failure ?? error.localizedDescription }
        let list = BoardLogic.projects(issueRepos: issueRepos, knownRepos: known)
        // Both reads failing keeps the last list rather than emptying the board.
        if !(failure != nil && list.isEmpty) { projects = list }
        projectsError = failure
        projectsLoaded = true
        let next = pick(preferred: preferred)
        if next != repo { repo = next; issues = nil; issuesError = nil }
    }

    private func pick(preferred: String) -> String {
        if projects.contains(repo) { return repo }
        let key = BoardLogic.repoKey(preferred)
        if !preferred.isEmpty, let match = projects.first(where: { BoardLogic.repoKey($0) == key }) { return match }
        return projects.first ?? ""
    }

    func select(_ path: String, client: BridgeClient) async {
        guard path != repo else { return }
        repo = path
        issues = nil
        issuesError = nil
        await reload(client: client)
    }

    /// Only the newest request for the current project may land; older ones are dropped.
    func reload(client: BridgeClient) async {
        let target = repo
        guard !target.isEmpty else { return }
        seq += 1
        let mine = seq
        do {
            let result = try await client.request("issue.list", ["repo": target], as: RepoIssues.self)
            guard mine == seq, target == repo else { return }
            issues = result
            issuesError = nil
        } catch {
            guard mine == seq, target == repo else { return }
            issuesError = error.localizedDescription
        }
    }

    /// A one-line notice that clears itself after ~3s unless a newer one replaced it.
    func flash(_ text: String) {
        notice = text
        noticeSeq += 1
        let mine = noticeSeq
        Task {
            try? await Task.sleep(for: .seconds(3))
            if noticeSeq == mine { notice = nil }
        }
    }
}

/// The Kanban board: one project at a time, four columns, one column's cards on screen (phone layout).
struct BoardView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage("board.repo") private var lastRepo = ""
    @State private var board = BoardModel()
    /// The user's column choice; nil follows the default (in progress when it has cards).
    @State private var column: BoardColumn?
    @State private var drawer: Story?
    @State private var showNew = false

    var body: some View {
        let attention = columnsData.attention
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("board").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
                    if attention > 0 {
                        Text("\(attention) need you")
                            .font(Theme.mono(12, .bold)).foregroundStyle(Theme.accent)
                            .accessibilityIdentifier("boardNeedYou")
                    }
                }
            } trailing: {
                Button { showNew = true } label: { HeaderIcon(systemName: "plus") }
                    .buttonStyle(.pressable)
                    .disabled(board.repo.isEmpty)
                    .accessibilityLabel("New story")
                    .accessibilityIdentifier("boardNewStory")
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) { content }
                    .padding(.horizontal, 20)
                    .padding(.top, 6)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .refreshable { await board.refresh(client: model.client, preferred: lastRepo, force: true) }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            while !Task.isCancelled {
                await board.refresh(client: model.client, preferred: lastRepo)
                try? await Task.sleep(for: .seconds(5))
            }
        }
        .onChange(of: board.repo) { _, new in if !new.isEmpty { lastRepo = new } }
        .sheet(item: $drawer) { story in
            StoryDrawer(repo: board.repo, story: story,
                        onChanged: { await board.reload(client: model.client) },
                        onStarted: started)
        }
        .sheet(isPresented: $showNew) {
            NewStorySheet(repo: board.repo) {
                column = .backlog
                Task { await board.reload(client: model.client) }
            }
        }
    }

    // MARK: Columns

    /// Cards whose task needs a person float to the head of IN PROGRESS; `attention` counts them.
    private var columnsData: (columns: [BoardColumnData], attention: Int) {
        guard let issues = board.issues else { return ([], 0) }
        let store = model.store
        let exists: ((String) -> Bool)? = store.loaded ? { store.task(id: $0) != nil } : nil
        let cols = BoardLogic.columns(issues.issues, taskExists: exists)
        let floated = BoardLogic.floatingAttention(cols, needsYou: { store.task(id: $0)?.group == .waitingOnYou })
        return (floated.columns, floated.count)
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        if !board.projectsLoaded {
            if let e = board.error { ErrorLine(text: e) } else { loadingLine }
        } else if board.projects.isEmpty {
            if let e = board.error { ErrorLine(text: e) }
            EmptyState(title: "no projects", detail: "save a project or open a task and its stories appear here")
        } else {
            projectTabs
            if let notice = board.notice {
                Text(notice).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .accessibilityIdentifier("boardNotice")
            }
            if !board.warnings.isEmpty { warningLines }
            if let e = board.error { ErrorLine(text: e) }
            stories
        }
    }

    private var loadingLine: some View {
        HStack(spacing: 8) {
            BrailleSpinner(size: 13)
            Text("loading").font(Theme.mono(13)).foregroundStyle(Theme.muted)
        }
    }

    private var projectTabs: some View {
        let labels = BoardCardLogic.projectLabels(board.projects)
        return ScrollView(.horizontal, showsIndicators: false) {
            ChoiceTiles(options: board.projects,
                        selection: Binding(get: { board.repo }, set: { selectProject($0) }),
                        label: { labels[$0] ?? $0 },
                        fill: false)
        }
        .accessibilityIdentifier("boardProjects")
    }

    private var warningLines: some View {
        Button { board.warnings = [] } label: {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(board.warnings, id: \.self) { ErrorLine(text: $0) }
                Theme.kicker("tap to dismiss")
            }
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier("boardWarnings")
    }

    @ViewBuilder private var stories: some View {
        if let issues = board.issues {
            let data = columnsData
            if issues.skipped > 0 {
                ErrorLine(text: "\(issues.skipped) unreadable record\(issues.skipped == 1 ? "" : "s") skipped, the board may be incomplete")
            }
            if issues.issues.isEmpty {
                EmptyState(title: "no stories", detail: "+ files one")
            } else {
                let key = column ?? BoardCardLogic.defaultColumn(data.columns)
                BoardColumnTabs(columns: data.columns, selection: Binding(get: { key }, set: { column = $0 }))
                if let current = data.columns.first(where: { $0.key == key }) {
                    BoardColumnList(column: current) { drawer = $0 }
                }
            }
        } else if board.error == nil {
            loadingLine
        }
    }

    private func selectProject(_ path: String) {
        column = nil
        Task { await board.select(path, client: model.client) }
    }

    /// A session was started from the drawer: follow it, or stay and say so for a moment.
    private func started(_ outcome: StartOutcome) {
        board.warnings.append(contentsOf: outcome.warnings)
        column = .inProgress
        Task { await board.reload(client: model.client) }
        if outcome.follow {
            model.path.append(.task(outcome.openTaskId))
        } else {
            board.flash("started #\(outcome.storyId) in the background")
        }
    }
}
