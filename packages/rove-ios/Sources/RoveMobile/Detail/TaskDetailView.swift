import SwiftUI

/// Task detail: the selected tab's terminal fills the screen; diff and land sit in the header strip.
struct TaskDetailView: View {
    let taskId: String
    /// Open on this tab (Inbox, F7) instead of the task's first engine tab.
    var tabId: String?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var tabs: [TabRow] = []
    @State private var selectedTabId: String?
    @State private var session: TerminalSession?
    @State private var diff: (files: Int, added: Int, deleted: Int)?
    @State private var error: String?
    @State private var tabSheet: TabSheetRoute?
    @State private var tabStates = TabStateModel()
    @State private var historySheet = false
    @State private var closing: TabRow?
    @State private var actions = TaskActionHost()
    @State private var confirmLand = false
    @State private var landResult: String?

    private var row: TaskRow? { model.store.task(id: taskId) }
    private var client: BridgeClient { model.client }
    private var selectedTab: TabRow? { tabs.first { $0.id == selectedTabId } }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                titleBlock
            } trailing: {
                moreMenu
            }
            metaStrip
            tabStrip
            if let error {
                Text(error).font(Theme.mono(12)).foregroundStyle(Theme.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.vertical, 6)
            }
            if let session {
                TerminalPane(session: session, engineName: selectedTab?.engineName)
                    .id(session.tabId)
            } else {
                noTabState
            }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .keyboardDoneButton()
        .task { await reload() }
        .task { await tabStates.poll(client: client, taskId: taskId) { selectedTabId } }
        .onChange(of: model.store.version) { Task { await reload() } }
        .mentionDelivery(taskId: taskId, session: session)
        .sheet(isPresented: $historySheet) { TaskHistorySheet(taskId: taskId) }
        .onAppear {
            session?.start()
            actions.onRemoved = { _ in dismiss() }
            actions.onOpenTask = { model.path.append(.task($0)) }
            Task { await actions.loadDetail(taskId) }
        }
        .onDisappear { session?.stop() }
        .tabSheets($tabSheet, taskId: taskId, row: row, sourceTab: selectedTab, session: session) { await openTab($0) }
        .taskActionSheets(actions)
        .confirmationDialog("Close this tab?", isPresented: Binding(get: { closing != nil }, set: { if !$0 { closing = nil } }),
                            titleVisibility: .visible) {
            Button("Close tab", role: .destructive) { if let t = closing { Task { await close(t) } } }
        }
        .confirmationDialog("Land this task", isPresented: $confirmLand, titleVisibility: .visible) {
            Button("Merge") { Task { await land("merge") } }
            Button("Squash") { Task { await land("squash") } }
        }
        .alert("Landed", isPresented: Binding(get: { landResult != nil }, set: { if !$0 { landResult = nil } })) {
            Button("OK") { landResult = nil }
        } message: { Text(landResult ?? "") }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(row?.displayTitle ?? String(localized: "loading task"))
                .font(Theme.face(16, .semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("taskTitle")
            if let branch = row?.branch, !branch.isEmpty {
                Text(branch)
                    .font(Theme.mono(12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }

    private var moreMenu: some View {
        Menu {
            TabActionItems(tab: selectedTab, session: session, route: $tabSheet)
            Button { historySheet = true } label: { Label("Engine history", systemImage: "text.alignleft") }
                .accessibilityIdentifier("historyButton")
            Divider()
            if let tab = selectedTab {
                Button { closing = tab } label: { Label("Close \(tab.displayTitle.lowercased())", systemImage: "xmark") }
            }
            Divider()
            TaskActionItems(host: actions, taskId: taskId)
        } label: {
            HeaderIcon(systemName: "ellipsis")
        }
        .accessibilityLabel("More")
        .accessibilityIdentifier("moreMenu")
    }

    /// Status tag · engine · live timer · PR; the terminal mode toggle on the right.
    private var metaStrip: some View {
        HStack(spacing: 8) {
            if let row {
                StatusTag(group: row.group)
                if let e = row.engine {
                    Text("·").font(Theme.mono(11)).foregroundStyle(Theme.muted)
                    Text(e.name.lowercased()).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                if row.activity != nil {
                    Text("·").font(Theme.mono(11)).foregroundStyle(Theme.muted)
                    TimelineView(.periodic(from: .distantPast, by: 1)) { ctx in
                        Text(model.store.activityMs(row, now: ctx.date).map { TaskListLogic.clock(ms: $0) } ?? "")
                            .font(Theme.mono(11))
                            .monospacedDigit()
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                            .fixedSize()
                            .contentTransition(.numericText())
                    }
                    .accessibilityIdentifier("activityTimer")
                }
                if let pr = row.pr { PRTag(pr: pr) }
            }
            Spacer(minLength: 4)
            if let session { modeToggle(session) }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }

    /// Terminal tabs in the TUI's bracket grammar (`[ codex ]`), then diff and land — first-class.
    private var tabStrip: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(tabs) { tab in
                        Button { select(tab) } label: { tabLabel(tab) }
                            .buttonStyle(.pressable)
                            .accessibilityIdentifier("tab-\(tab.id)")
                    }
                    Button { tabSheet = .newSession(SessionPreset()) } label: {
                        Text("+ tab").font(Theme.mono(13)).foregroundStyle(Theme.muted)
                            .padding(.horizontal, 6).frame(height: 32)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityLabel("New engine tab")
                }
                .padding(.leading, 12)
            }
            NavigationLink(value: Route.diff(taskId: taskId)) {
                HStack(spacing: 6) {
                    Text("diff").foregroundStyle(Theme.ink)
                    if let diff, diff.files > 0 {
                        Text("+\(diff.added)").foregroundStyle(Theme.success)
                        Text("−\(diff.deleted)").foregroundStyle(Theme.error)
                    }
                }
                .font(Theme.mono(12, .medium))
                .monospacedDigit()
                .fixedSize()
                .padding(.horizontal, 10)
                .frame(height: 30)
                .tile(radius: Theme.smallRadius)
            }
            .buttonStyle(.pressable)
            .accessibilityIdentifier("diffLink")
            Button { confirmLand = true } label: {
                Text("land")
                    .font(Theme.mono(12, .semibold))
                    .foregroundStyle(Theme.paper)
                    .fixedSize()
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
            }
            .buttonStyle(.pressable)
            .accessibilityIdentifier("landButton")
            .padding(.trailing, 16)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func tabLabel(_ tab: TabRow) -> some View {
        let selected = tab.id == selectedTabId
        let glyph = tabStates.glyph(taskId: taskId, tab: tab)
        return HStack(spacing: 0) {
            Text(selected ? "[ " : "  ").foregroundStyle(Theme.accent)
            TabGlyphView(glyph: glyph)
            Text(" ")
            Text(tab.displayTitle.lowercased()).foregroundStyle(selected ? Theme.ink : Theme.muted)
            Text(selected ? " ]" : "  ").foregroundStyle(Theme.accent)
        }
        .font(Theme.mono(13, selected ? .bold : .regular))
        .frame(height: 32)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(tab.displayTitle), \(glyph.word)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// `fit · watch` — reflow to the phone, or watch at the desktop's 120 columns.
    private func modeToggle(_ session: TerminalSession) -> some View {
        HStack(spacing: 6) {
            ForEach(TerminalMode.allCases) { mode in
                Button {
                    withAnimation(Theme.spring) { session.mode = mode }
                } label: {
                    Text(mode.label)
                        .font(Theme.mono(12, session.mode == mode ? .semibold : .regular))
                        .foregroundStyle(session.mode == mode ? Theme.accent : Theme.muted)
                }
                .buttonStyle(.pressable)
                .accessibilityAddTraits(session.mode == mode ? .isSelected : [])
                if mode != TerminalMode.allCases.last { Text("·").font(Theme.mono(12)).foregroundStyle(Theme.muted) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Terminal mode")
    }

    private var noTabState: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(tabs.isEmpty ? String(localized: "no terminal tabs") : String(localized: "pick a tab")).font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink)
                Text("open an engine tab to give this task its next message")
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted)
            }
            if tabs.isEmpty {
                Button { tabSheet = .newSession(SessionPreset(reopen: true)) } label: { TileLabel(text: String(localized: "reopen session"), tint: Theme.accent) }
                    .buttonStyle(.pressable)
                    .accessibilityIdentifier("reopenSession")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 20).padding(.top, 24)
    }

    private func select(_ tab: TabRow) {
        guard tab.id != selectedTabId else { return }
        session?.stop()
        selectedTabId = tab.id
        let next = TerminalSession(client: client, taskId: taskId, tabId: tab.id)
        session = next
        next.start()
        model.visit(taskId: taskId, tabId: tab.id)
        tabStates.markSeen(taskId: taskId, tabId: tab.id)
    }

    private func reload() async {
        async let tabsReq = client.request("task.tabs", ["taskId": taskId], as: TabsResult.self)
        async let diffReq = client.request("diff.files", ["taskId": taskId], as: DiffFilesResult.self)
        do {
            tabs = try await tabsReq.tabs
            error = nil
        } catch { self.error = error.localizedDescription }
        if let files = try? await diffReq.files {
            diff = (files.count, files.reduce(0) { $0 + ($1.added ?? 0) }, files.reduce(0) { $0 + ($1.deleted ?? 0) })
        }
        if selectedTab == nil {
            session?.stop(); session = nil; selectedTabId = nil
            let wanted = tabId.flatMap { id in tabs.first { $0.id == id } }
            if let first = wanted ?? tabs.first(where: { $0.kind == "engine" }) ?? tabs.first { select(first) }
        }
    }

    /// A tab the new-session or rename sheet just touched: refresh the strip, then show it.
    private func openTab(_ id: String) async {
        await reload()
        if let tab = tabs.first(where: { $0.id == id }) { select(tab) }
    }

    private func close(_ tab: TabRow) async {
        closing = nil
        do { _ = try await client.request("tab.close", ["taskId": taskId, "tabId": tab.id], as: EmptyResult.self); await reload() }
        catch { self.error = error.localizedDescription }
    }

    private func land(_ strategy: String) async {
        do {
            let r = try await client.request("task.land", ["taskId": taskId, "strategy": strategy], as: TaskLandResult.self)
            landResult = String(localized: "Landed on \(r.landedOn) (\(String(r.commit.prefix(8))))")
        } catch { self.error = error.localizedDescription }
    }
}
