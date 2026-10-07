import SwiftUI

/// `#12 ✓` — the PR number in muted mono, then the check / conflict mark (see `TaskRowMarks`).
/// Without `chip` the mark is derived from `pr` itself, which is all the detail header has.
struct PRTag: View {
    var pr: TaskPR
    var chip: String?
    var stale = false

    var body: some View {
        let mark = TaskRowMarks.prMark(kind: chip ?? TaskRowMarks.chipKind(pr), stale: stale)
        HStack(spacing: 3) {
            if let n = TaskRowMarks.prNumber(pr) {
                Text(n).font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted)
            }
            if let mark { MarkText(segments: [mark]) }
        }
        .lineLimit(1)
        .fixedSize()
    }
}

/// Row press feedback: accentSoft wash + 0.97 scale, critically damped.
struct RowButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .background(configuration.isPressed ? Theme.accentSoft : .clear,
                        in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1.0)
            .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.25, dampingFraction: 1.0),
                       value: configuration.isPressed)
    }
}

struct TaskListView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("taskSortMode") private var sortRaw = TaskSortMode.attention.rawValue
    @State private var showNew = false
    @State private var searching = false
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    /// The one owner of task / project action sheets for this screen (row and project menus feed it).
    @State private var actions = TaskActionHost()

    private var sortMode: TaskSortMode { TaskSortMode(rawValue: sortRaw) ?? .attention }
    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        @Bindable var store = model.store
        let sections = store.projects(mode: sortMode, query: searching ? query : "")
        let shown = sections.reduce(0) { $0 + $1.rows.count }
        VStack(spacing: 0) {
            ScreenHeader {
                BracketChip(size: 19).fixedSize().accessibilityAddTraits(.isHeader)
            } trailing: {
                attentionButton
                filterMenu
                searchButton
                sortMenu
                Menu {
                    Button("board") { model.path.append(.board) }.accessibilityIdentifier("page-board")
                    Button("routines") { model.path.append(.routines) }.accessibilityIdentifier("page-routines")
                    Button("github issues") { model.path.append(.issues) }.accessibilityIdentifier("page-issues")
                    Button("worktrees") { model.path.append(.worktrees) }.accessibilityIdentifier("page-worktrees")
                } label: { HeaderIcon(systemName: "square.grid.2x2") }
                    .accessibilityLabel("Pages")
                    .accessibilityIdentifier("pagesMenu")
                Button { model.path.append(.settings) } label: { HeaderIcon(systemName: "gearshape") }
                    .buttonStyle(.pressable)
                    .accessibilityLabel("Settings")
                    .accessibilityIdentifier("settingsButton")
            }
            connectionStrip(shown: shown)
            if searching { searchBar }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let e = store.error {
                        Text(e).font(Theme.mono(12)).foregroundStyle(Theme.error)
                            .padding(.horizontal, 20).padding(.vertical, 8)
                    }
                    ForEach(sections, id: \.repo) { project in
                        projectSection(project.repo, project.rows)
                    }
                    emptyView(TaskListLogic.emptiness(loaded: store.loaded, total: store.tasks.count, shown: shown))
                    if !store.loaded {
                        HStack(spacing: 8) {
                            BrailleSpinner(size: 13)
                            Text(connectionSpinnerWord(model.client.state)).font(Theme.mono(13)).foregroundStyle(Theme.muted)
                        }
                        .padding(.horizontal, 20).padding(.top, 24)
                    }
                }
                .padding(.bottom, 16)
            }
            .refreshable { await store.refresh() }
            newTaskBar
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .keyboardDoneButton(active: model.sheets.isEmpty)
        .onAppear { actions.onOpenTask = { [model] id in model.path.append(.task(id)) } }
        .taskActionSheets(actions)
        .sheet(isPresented: $showNew) {
            NewTaskView { id in model.path.append(.task(id)) }
        }
    }

    private var attentionButton: some View {
        Button { model.path.append(.inbox) } label: {
            HStack(spacing: 3) {
                HeaderIcon(systemName: "bell", tint: model.store.attentionCount > 0 ? Theme.accent : Theme.muted)
                    .frame(width: 24)
                if model.store.attentionCount > 0 {
                    Text("\(model.store.attentionCount)")
                        .font(Theme.mono(13, .bold)).monospacedDigit()
                        .foregroundStyle(Theme.accent)
                }
            }
            .frame(minWidth: 36, minHeight: 36)
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Attention, \(model.store.attentionCount) unread")
        .accessibilityIdentifier("inboxButton")
    }

    private var filterMenu: some View {
        @Bindable var store = model.store
        return Menu {
            Picker("Project", selection: $store.repoFilter) {
                Text("all projects").tag(String?.none)
                ForEach(store.repos, id: \.self) { Text(URL(fileURLWithPath: $0).lastPathComponent).tag(String?.some($0)) }
            }
        } label: {
            HeaderIcon(systemName: "line.3.horizontal.decrease",
                       tint: store.repoFilter == nil ? Theme.muted : Theme.accent)
        }
        .accessibilityLabel("Filter by project")
    }

    private var searchButton: some View {
        Button { toggleSearch() } label: {
            HeaderIcon(systemName: "magnifyingglass", tint: searching ? Theme.accent : Theme.muted)
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Search")
        .accessibilityIdentifier("searchButton")
    }

    /// Sort icon, accent once the order is not the default; the menu lists the four modes.
    private var sortMenu: some View {
        Menu {
            Picker("Sort", selection: $sortRaw) {
                ForEach(TaskSortMode.allCases) { Text($0.label).tag($0.rawValue) }
            }
        } label: {
            HeaderIcon(systemName: "arrow.up.arrow.down", tint: sortMode == .attention ? Theme.muted : Theme.accent)
        }
        .accessibilityLabel("Sort: \(sortMode.label)")
        .accessibilityIdentifier("sortMenu")
    }

    private var searchBar: some View {
        FieldBox {
            HStack(spacing: 8) {
                TextField("search title, repo, branch, tab", text: $query)
                    .focused($searchFocused)
                    .submitLabel(.search)
                    .accessibilityIdentifier("searchField")
                if !query.isEmpty {
                    Button { query = "" } label: { Text("×").font(Theme.mono(16)).foregroundStyle(Theme.muted) }
                        .buttonStyle(.pressable)
                        .accessibilityLabel("Clear search")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    /// Closing the field clears the query, which restores the full list.
    private func toggleSearch() {
        withAnimation(Theme.spring) { searching.toggle() }
        if searching {
            searchFocused = true
            Task { await model.store.loadTabTitles() }
        } else { query = ""; searchFocused = false }
    }

    private func connectionWord(_ state: ConnectionState) -> String {
        switch state {
        case .connected: String(localized: "connected")
        case .connecting: String(localized: "connecting")
        case .reconnecting(let n): String(localized: "reconnecting · try \(n)")
        case .disconnected: String(localized: "offline")
        case .failed: String(localized: "failed")
        }
    }

    /// The loading line under the list: the bridge's own failure text stays verbatim.
    private func connectionSpinnerWord(_ state: ConnectionState) -> String {
        if case .failed(let m) = state { return m.lowercased() }
        return connectionWord(state)
    }

    /// `HOST · CONNECTED` at rest; accent while reconnecting, error red when the link failed.
    private func connectionStrip(shown: Int) -> some View {
        let state = model.client.state
        let tone: Color = switch state {
        case .connected: Theme.muted
        case .failed: Theme.error
        default: Theme.accent
        }
        let host = model.client.hello?.host ?? model.pairing?.display ?? ""
        let word = connectionWord(state)
        return HStack(spacing: 8) {
            Theme.kicker([host, word].filter { !$0.isEmpty }.joined(separator: " · "), color: tone)
            Spacer()
            if let f = model.store.repoFilter {
                Button { model.store.repoFilter = nil } label: {
                    Theme.kicker("\(URL(fileURLWithPath: f).lastPathComponent) ×", color: Theme.accent)
                }
                .buttonStyle(.pressable)
            } else {
                Theme.kicker(String(localized: "\(String(format: "%02d", shown)) tasks"))
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
    }

    private func projectSection(_ repo: String, _ rows: [TaskRow]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Theme.kicker(URL(fileURLWithPath: repo).lastPathComponent)
                Spacer()
                Text(String(format: "%02d", rows.count))
                    .font(Theme.mono(11)).monospacedDigit()
                    .foregroundStyle(Theme.muted)
                Menu { ProjectActionItems(host: actions, repo: repo) } label: {
                    Text("···").font(Theme.mono(14, .bold)).foregroundStyle(Theme.muted)
                        .frame(width: 36, height: 28)
                }
                .accessibilityLabel("Project actions")
                .accessibilityIdentifier("projectMenu-\(URL(fileURLWithPath: repo).lastPathComponent)")
            }
            .padding(.leading, 20)
            .padding(.trailing, 12)
            .padding(.top, 18)
            .padding(.bottom, 2)
            ForEach(rows) { row in
                NavigationLink(value: Route.task(row.id)) { TaskRowView(row: row) }
                    .buttonStyle(RowButtonStyle())
                    .padding(.horizontal, 8)
                    .contextMenu { TaskActionItems(host: actions, taskId: row.id) }
                    .accessibilityIdentifier("task-\(row.id)")
            }
        }
    }

    /// Welcome when the daemon has no tasks at all; `no matches` when a search or project filter hides them all.
    @ViewBuilder private func emptyView(_ kind: TaskListEmpty) -> some View {
        switch kind {
        case .none: EmptyView()
        case .welcome: TaskWelcomeView()
        case .noMatches:
            EmptyState(title: String(localized: "no matches"),
                       detail: trimmedQuery.isEmpty
                           ? String(localized: "this project has no tasks — clear the filter above")
                           : String(localized: "nothing matches “\(trimmedQuery)” — clear the search"))
                .padding(.horizontal, 20).padding(.top, 28)
                .accessibilityIdentifier("noMatches")
        }
    }

    /// Full-width pressable bar, quill record-control grammar.
    private var newTaskBar: some View {
        Button { showNew = true } label: {
            HStack(spacing: 12) {
                Text("+").font(Theme.mono(20, .medium)).foregroundStyle(Theme.accent)
                Text("new task").font(Theme.mono(16, .medium)).foregroundStyle(Theme.ink)
                Spacer()
                Theme.kicker(String(localized: "worktree"))
            }
            .padding(.horizontal, 18)
            .frame(height: 56)
            .tile(radius: 14)
            .shadow(color: Theme.shadow, radius: 6, y: 2)
        }
        .buttonStyle(.pressable)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(Theme.paper)
        .accessibilityLabel("New task")
        .accessibilityIdentifier("newTaskButton")
    }
}
