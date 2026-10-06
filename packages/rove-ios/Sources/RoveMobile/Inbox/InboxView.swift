import SwiftUI

/// Inbox: ATTENTION (what needs me — blocked first, oldest first) and RECENT (where was I — the
/// last tabs this phone opened). Opening an item lands on its exact tab and clears it.
struct InboxView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    /// Title and running flag for the tabs RECENT shows, keyed `task\0tab`.
    @State private var tabInfo: [String: RecentTab] = [:]

    struct RecentTab: Equatable {
        var title: String
        var running: Bool
    }

    private var store: TaskStore { model.store }
    private var pending: [AttentionItem] {
        InboxLogic.sorted(store.attention, taskOrder: TaskListLogic.sorted(store.tasks).map(\.id))
    }
    private var recent: [Visit] {
        InboxLogic.recent(visits: model.inbox.visits, attention: store.attention, taskIds: Set(store.tasks.map(\.id)))
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text("inbox").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
            } trailing: {
                if InboxLogic.next(after: nil, in: pending) != nil {
                    Button(action: jumpNext) { TileLabel(text: "next pending", tint: Theme.accent, size: 12) }
                        .buttonStyle(.pressable)
                        .accessibilityIdentifier("nextPending")
                }
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    section("attention", count: pending.count)
                    if pending.isEmpty {
                        EmptyState(title: "nothing needs you", detail: "blocked agents and finished turns land here")
                            .padding(.horizontal, 20).padding(.vertical, 8)
                    }
                    ForEach(pending, id: \.self) { attentionRow($0) }
                    section("recent", count: recent.count)
                    if recent.isEmpty {
                        EmptyState(title: "no recent tabs", detail: "tabs you open on this phone show up here")
                            .padding(.horizontal, 20).padding(.vertical, 8)
                    }
                    ForEach(recent, id: \.self) { recentRow($0) }
                }
                .padding(.bottom, 24)
            }
            .refreshable { await store.refresh() }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task(id: recent) { await loadTabInfo(for: recent) }
    }

    private func section(_ name: String, count: Int) -> some View {
        HStack {
            Theme.kicker(name)
            Spacer()
            Text(String(format: "%02d", count)).font(Theme.mono(11)).monospacedDigit().foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 4)
    }

    // MARK: Rows

    private func attentionRow(_ item: AttentionItem) -> some View {
        let blocking = InboxLogic.isBlocking(item)
        let task = item.taskId.flatMap { store.task(id: $0) }
        let title = task?.displayTitle ?? item.label ?? item.taskId ?? "routine"
        return HStack(spacing: 0) {
            Button { open(item) } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(InboxLogic.glyph(item.state)).font(Theme.mono(12, .semibold))
                        Text(InboxLogic.stateWord(item.state)).font(Theme.mono(11, .semibold))
                        if item.state == "rate_limited", let resume = InboxLogic.resumeLabel(iso: item.resumeAt) {
                            Text(resume).font(Theme.mono(11)).foregroundStyle(Theme.muted)
                        }
                    }
                    .foregroundStyle(blocking ? Theme.accent : Theme.muted)
                    Text(title).font(Theme.face(16, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    HStack(spacing: 6) {
                        if let tab = item.tabId { Text(tab).font(Theme.mono(12)).foregroundStyle(Theme.muted) }
                        TimelineView(.periodic(from: .distantPast, by: 30)) { ctx in
                            Text(TaskListLogic.age(ms: ctx.date.timeIntervalSince1970 * 1000 - item.at))
                                .font(Theme.mono(12)).monospacedDigit().foregroundStyle(Theme.muted)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 10)
            }
            .buttonStyle(RowButtonStyle())
            .accessibilityIdentifier("attention-\(InboxLogic.key(item))")
            if item.taskId != nil {
                Button { Task { await store.dismissAttention(item) } } label: {
                    Text("dismiss").font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        .padding(.horizontal, 10).frame(minHeight: 44)
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("Dismiss without opening")
                .accessibilityIdentifier("dismiss-\(InboxLogic.key(item))")
            }
        }
        .padding(.horizontal, 8)
    }

    private func recentRow(_ visit: Visit) -> some View {
        let task = store.task(id: visit.taskId)
        let info = tabInfo["\(visit.taskId)\u{0}\(visit.tabId ?? "")"]
        return Button {
            model.path.append(visit.tabId.map { Route.taskTab(visit.taskId, $0) } ?? .task(visit.taskId))
        } label: {
            HStack(spacing: 8) {
                if info?.running == true { BrailleSpinner(size: 12) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(task?.displayTitle ?? visit.taskId).font(Theme.face(16, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    if let tab = info?.title ?? visit.tabId {
                        Text(tab.lowercased()).font(Theme.mono(12)).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(TaskListLogic.age(ms: Date().timeIntervalSince1970 * 1000 - visit.at))
                    .font(Theme.mono(12)).monospacedDigit().foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
        .buttonStyle(RowButtonStyle())
        .padding(.horizontal, 8)
        .accessibilityIdentifier("recent-\(visit.taskId)")
    }

    // MARK: Actions

    private func open(_ item: AttentionItem) { model.open(attention: item) }

    /// F7: the oldest blocked item (else the oldest finished turn); repeated presses walk on.
    private func jumpNext() { _ = model.openNextPending() }

    /// Tab names and which of them are still running, for the RECENT rows.
    private func loadTabInfo(for visits: [Visit]) async {
        var info: [String: RecentTab] = [:]
        for taskId in Set(visits.map(\.taskId)) {
            async let tabs = try? await model.client.request("task.tabs", ["taskId": taskId], as: TabsResult.self)
            async let states = try? await model.client.request("tab.states", ["taskId": taskId], as: TabStatesResult.self)
            let (rows, activity) = await (tabs, states)
            for tab in rows?.tabs ?? [] {
                info["\(taskId)\u{0}\(tab.id)"] = RecentTab(title: tab.displayTitle, running: activity?.tabs[tab.id]?.state == "running")
            }
        }
        tabInfo = info
    }
}
