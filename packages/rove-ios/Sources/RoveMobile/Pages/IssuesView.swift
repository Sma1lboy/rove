import SwiftUI

/// A `gh` failure (`no-remote: …`, `gh-missing: …`, `auth: …`) split into what to do and what was said.
/// A normal state of this page, not a crash.
private struct IssueFailure {
    let headline: String
    let raw: String

    init(_ error: Error) {
        if let bridge = error as? BridgeError {
            raw = bridge.message.isEmpty ? bridge.code : bridge.message
        } else {
            raw = error.localizedDescription
        }
        headline = WorkItemLogic.errorHint(raw)
    }
}

private enum IssueFilter: Hashable {
    case all, mine

    var label: String { self == .all ? "all" : "assigned to me" }
}

/// The repo's GitHub issues through `gh` (read-only), with the tasks already started from them.
/// A row with a task opens that task; any other row opens `StartIssueSheet`.
struct IssuesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage("issues.repo") private var storedRepo = ""
    @State private var repos: [String]?
    @State private var reposFailure: IssueFailure?
    @State private var filter = IssueFilter.all
    @State private var items: [WorkItem]?
    @State private var links: [WorkItemLink] = []
    @State private var failure: IssueFailure?
    @State private var startItem: WorkItem?
    /// A task started in the sheet; pushed once the sheet is gone.
    @State private var pendingTask: String?

    /// The remembered repo while it still exists, else the first one.
    private var currentRepo: String {
        guard let repos, !repos.isEmpty else { return "" }
        return repos.contains(storedRepo) ? storedRepo : repos[0]
    }

    /// Changing either half reloads the list.
    private var loadKey: String { "\(currentRepo)|\(filter == .mine ? "mine" : "all")" }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text("github issues").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
            } trailing: {
                Button { Task { await load(refresh: true) } } label: { HeaderIcon(systemName: "arrow.clockwise") }
                    .buttonStyle(.pressable)
                    .accessibilityLabel("Refresh issues")
                    .accessibilityIdentifier("issuesRefresh")
            }
            if let repos, !repos.isEmpty { controls(repos) }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) { content }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
            }
            .refreshable { await load() }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await loadRepos() }
        .task(id: loadKey) {
            items = nil
            links = []
            failure = nil
            await load()
        }
        .sheet(item: $startItem, onDismiss: startClosed) { item in
            StartIssueSheet(repo: currentRepo, item: item) { taskId in pendingTask = taskId }
        }
    }

    // MARK: Layout

    private func controls(_ repos: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                ChoiceTiles(options: repos, selection: Binding(get: { currentRepo }, set: { storedRepo = $0 }),
                            label: { URL(fileURLWithPath: $0).lastPathComponent }, fill: false)
                    .padding(.horizontal, 16)
            }
            .accessibilityIdentifier("issuesRepoPicker")
            ChoiceTiles(options: [IssueFilter.all, .mine], selection: $filter, label: { $0.label })
                .padding(.horizontal, 16)
                .accessibilityIdentifier("issuesFilter")
        }
        .padding(.bottom, 6)
    }

    @ViewBuilder private var content: some View {
        if let reposFailure {
            failureView(reposFailure, id: "issuesReposRetry") { await loadRepos() }
        } else if let repos, repos.isEmpty {
            EmptyState(title: "no repos", detail: "add a project on the mac first")
                .padding(.horizontal, 4).padding(.top, 12)
        } else if let failure {
            failureView(failure, id: "issuesRetry") { await load() }
        } else if let items {
            if items.isEmpty {
                EmptyState(title: "no issues", detail: "nothing open for this filter")
                    .padding(.horizontal, 4).padding(.top, 12)
            }
            ForEach(items) { item in row(item) }
        } else {
            HStack(spacing: 8) {
                BrailleSpinner(size: 13)
                Text("loading").font(Theme.mono(13)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 4).padding(.top, 16)
        }
    }

    /// The hint is the headline; the raw message stays muted below it unless it already is the headline.
    private func failureView(_ failure: IssueFailure, id: String, retry: @escaping () async -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ErrorLine(text: failure.headline)
            if failure.raw != failure.headline {
                Text(failure.raw).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button { Task { await retry() } } label: { TileLabel(text: "retry") }
                .buttonStyle(.pressable)
                .accessibilityIdentifier(id)
        }
        .padding(.horizontal, 4).padding(.top, 8)
    }

    private func row(_ item: WorkItem) -> some View {
        let linkedTask = WorkItemLogic.linkedTask(for: item, in: links)
        return Button { select(item, linkedTask: linkedTask) } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("#\(item.number)").font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink)
                    Text(item.title)
                        .font(Theme.face(15, .semibold)).foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading).lineLimit(2)
                    Spacer(minLength: 0)
                }
                Text(meta(item))
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.leading).lineLimit(2)
                if let linkedTask {
                    HStack(spacing: 6) {
                        Text("task").font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted)
                        if let task = model.store.task(id: linkedTask) { StatusTag(group: task.group) }
                        Text("opens task").font(Theme.mono(11)).foregroundStyle(Theme.muted)
                    }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tile()
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier("issueRow-\(item.number)")
    }

    /// `author · 3d ago · [bug] [ui] [p1]` — the first three labels.
    private func meta(_ item: WorkItem) -> String {
        let who = [item.author, RoutineLogic.ago(item.updatedAt, now: Date())]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        let labels = item.labels.prefix(3).map { "[\($0)]" }.joined(separator: " ")
        return [who, labels].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // MARK: Ops

    /// An issue that already has a task opens it; a second one is never created.
    private func select(_ item: WorkItem, linkedTask: String?) {
        if let linkedTask {
            model.path.append(.task(linkedTask))
        } else {
            startItem = item
        }
    }

    private func startClosed() {
        guard let id = pendingTask else { return }
        pendingTask = nil
        model.path.append(.task(id))
        Task { await load() }
    }

    private func loadRepos() async {
        do {
            repos = try await model.client.request("repos.list", as: ReposResult.self).repos
            reposFailure = nil
        } catch { reposFailure = IssueFailure(error) }
    }

    /// `refresh` bypasses the daemon's 60s cache; only the header icon asks for it.
    private func load(refresh: Bool = false) async {
        let repo = currentRepo
        guard !repo.isEmpty else { return }
        let key = loadKey
        var args: [String: Any] = ["repo": repo, "state": "open", "limit": 50]
        if filter == .mine { args["assignee"] = "@me" }
        if refresh { args["refresh"] = true }
        do {
            let list = try await model.client.request("workitem.list", args, as: WorkItemsPayload.self).items
            let linked = try await model.client.request("workitem.links", ["repo": repo], as: WorkItemLinksPayload.self).links
            guard key == loadKey else { return }
            items = list
            links = linked
            failure = nil
        } catch {
            guard key == loadKey else { return }
            failure = IssueFailure(error)
        }
    }
}
