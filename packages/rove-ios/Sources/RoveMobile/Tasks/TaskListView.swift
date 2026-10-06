import SwiftUI

func checkStateColor(_ s: String) -> Color {
    let l = s.lowercased()
    if l.contains("pass") || l.contains("success") || l.contains("green") { return Theme.success }
    if l.contains("fail") || l.contains("error") || l.contains("red") { return Theme.error }
    return Theme.muted
}

/// `#12 passing` — mono, coloured by CI state.
struct PRTag: View {
    var pr: TaskPR
    var body: some View {
        Text([pr.number.map { "#\($0)" }, pr.checkState].compactMap { $0 }.joined(separator: " "))
            .font(Theme.mono(11, .medium))
            .foregroundStyle(checkStateColor(pr.checkState))
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

struct TaskRowView: View {
    var row: TaskRow
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(row.displayTitle)
                    .font(Theme.face(16, .medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if row.deleting {
                        Text("deleting").font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted)
                    } else {
                        StatusTag(group: row.group)
                    }
                    if row.kind == "main" {
                        Text("main checkout").font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    } else if !row.branch.isEmpty {
                        Text(row.branch)
                            .font(Theme.mono(12))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    if let pr = row.pr { PRTag(pr: pr) }
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 5) {
                TimelineView(.periodic(from: .distantPast, by: 1)) { ctx in
                    Text(model.store.activityMs(row, now: ctx.date).map { TaskListLogic.age(ms: $0) } ?? "—")
                        .font(Theme.mono(13))
                        .monospacedDigit()
                        .foregroundStyle(Theme.muted)
                }
                if let e = row.engine {
                    Text(e.name.lowercased()).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}

struct TaskListView: View {
    @Environment(AppModel.self) private var model
    @State private var showAttention = false
    @State private var showSettings = false
    @State private var showNew = false

    var body: some View {
        @Bindable var store = model.store
        VStack(spacing: 0) {
            ScreenHeader {
                BracketChip(size: 19).accessibilityAddTraits(.isHeader)
            } trailing: {
                attentionButton
                filterMenu
                Menu {
                    Button("board") { model.path.append(.board) }
                    Button("routines") { model.path.append(.routines) }
                    Button("github issues") { model.path.append(.issues) }
                    Button("worktrees") { model.path.append(.worktrees) }
                } label: { HeaderIcon(systemName: "square.grid.2x2") }
                    .accessibilityLabel("Pages")
                    .accessibilityIdentifier("pagesMenu")
                Button { showSettings = true } label: { HeaderIcon(systemName: "gearshape") }
                    .buttonStyle(.pressable)
                    .accessibilityLabel("Settings")
                    .accessibilityIdentifier("settingsButton")
            }
            connectionStrip
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let e = store.error {
                        Text(e).font(Theme.mono(12)).foregroundStyle(Theme.error)
                            .padding(.horizontal, 20).padding(.vertical, 8)
                    }
                    ForEach(store.projects, id: \.repo) { project in
                        projectSection(project.repo, project.rows)
                    }
                    if store.loaded && store.visible.isEmpty { emptyState }
                    if !store.loaded {
                        HStack(spacing: 8) {
                            BrailleSpinner(size: 13)
                            Text(model.client.state.label.lowercased()).font(Theme.mono(13)).foregroundStyle(Theme.muted)
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
        .sheet(isPresented: $showAttention) { AttentionSheet() }
        .sheet(isPresented: $showSettings) { NavigationStack { PairingView() } }
        .sheet(isPresented: $showNew) {
            NewTaskView { id in model.path.append(.task(id)) }
        }
    }

    private var attentionButton: some View {
        Button { showAttention = true } label: {
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

    /// `HOST · CONNECTED` at rest; accent while reconnecting, error red when the link failed.
    private var connectionStrip: some View {
        let state = model.client.state
        let tone: Color = switch state {
        case .connected: Theme.muted
        case .failed: Theme.error
        default: Theme.accent
        }
        let host = model.client.hello?.host ?? model.pairing?.display ?? ""
        let word: String = switch state {
        case .connected: "connected"
        case .connecting: "connecting"
        case .reconnecting(let n): "reconnecting · try \(n)"
        case .disconnected: "offline"
        case .failed: "failed"
        }
        return HStack(spacing: 8) {
            Theme.kicker([host, word].filter { !$0.isEmpty }.joined(separator: " · "), color: tone)
            Spacer()
            if let f = model.store.repoFilter {
                Button { model.store.repoFilter = nil } label: {
                    Theme.kicker("\(URL(fileURLWithPath: f).lastPathComponent) ×", color: Theme.accent)
                }
                .buttonStyle(.pressable)
            } else {
                Theme.kicker(String(format: "%02d tasks", model.store.visible.count))
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
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 4)
            ForEach(rows) { row in
                NavigationLink(value: Route.task(row.id)) { TaskRowView(row: row) }
                    .buttonStyle(RowButtonStyle())
                    .padding(.horizontal, 8)
                    .accessibilityIdentifier("task-\(row.id)")
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("no tasks on this mac").font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink)
            Text("start one below — each gets its own worktree and branch")
                .font(Theme.mono(12)).foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 20).padding(.top, 28)
    }

    /// Full-width pressable bar, quill record-control grammar.
    private var newTaskBar: some View {
        Button { showNew = true } label: {
            HStack(spacing: 12) {
                Text("+").font(Theme.mono(20, .medium)).foregroundStyle(Theme.accent)
                Text("new task").font(Theme.mono(16, .medium)).foregroundStyle(Theme.ink)
                Spacer()
                Theme.kicker("worktree")
            }
            .padding(.horizontal, 18)
            .frame(height: 56)
            .tile(radius: 14)
            .shadow(color: .black.opacity(0.04), radius: 6, y: 2)
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

struct AttentionSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if model.store.attention.isEmpty { ContentUnavailableView("Nothing needs you", systemImage: "checkmark.circle") }
                ForEach(Array(model.store.attention.enumerated()), id: \.offset) { _, item in
                    Button {
                        if let id = item.taskId { dismiss(); model.path.append(.task(id)) }
                    } label: {
                        HStack {
                            Circle().fill(item.unread ? Theme.accent : Color.clear).frame(width: 8, height: 8)
                            VStack(alignment: .leading) {
                                Text(item.taskId.flatMap { model.store.task(id: $0)?.displayTitle } ?? item.taskId ?? "—")
                                Text(item.state).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Date(timeIntervalSince1970: item.at > 1e11 ? item.at / 1000 : item.at), style: .relative)
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions { Button("Dismiss") { Task { await model.store.dismissAttention(item) } } }
                }
            }
            .navigationTitle("Attention")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
