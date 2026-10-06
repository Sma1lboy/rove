import Foundation
import Observation

enum TaskListLogic {
    // `sorted` / `projects` / `emptiness` live in TaskListOrdering.swift; search in TaskSearch.swift.

    static func attentionCount(_ items: [AttentionItem]) -> Int { items.filter(\.unread).count }

    static func repos(_ rows: [TaskRow]) -> [String] {
        Array(Set(rows.map(\.repo).filter { !$0.isEmpty })).sorted()
    }

    static func filtered(_ rows: [TaskRow], repo: String?) -> [TaskRow] {
        guard let repo else { return rows }
        return rows.filter { $0.repo == repo }
    }

    /// Age of the row's activity now: server `forMs` at receipt plus local elapsed time.
    static func ageMs(forMs: Double, receivedAt: Date, now: Date) -> Double {
        forMs + max(0, now.timeIntervalSince(receivedAt)) * 1000
    }

    static func age(ms: Double) -> String {
        let s = Int(ms / 1000)
        if s < 60 { return "\(max(s, 0))s" }
        if s < 3600 { return "\(s / 60)m" }
        if s < 86400 { return "\(s / 3600)h" }
        return "\(s / 86400)d"
    }

    /// Second-precision elapsed time for a live timer: `9s`, `4m07s`, `2h03m`, then days.
    static func clock(ms: Double) -> String {
        let s = max(Int(ms / 1000), 0)
        if s < 60 { return "\(s)s" }
        if s < 3600 { return String(format: "%dm%02ds", s / 60, s % 60) }
        if s < 86400 { return String(format: "%dh%02dm", s / 3600, (s % 3600) / 60) }
        return age(ms: ms)
    }
}

@MainActor @Observable
final class TaskStore {
    private(set) var tasks: [TaskRow] = []
    private(set) var attention: [AttentionItem] = []
    private(set) var loaded = false
    /// Bumped on every `tasks` snapshot so detail screens can refresh their tabs.
    private(set) var version = 0
    var repoFilter: String?
    var error: String?

    @ObservationIgnored private let client: BridgeClient
    @ObservationIgnored private var receivedAt: [String: Date] = [:]
    @ObservationIgnored var onNotice: (TaskNotice) -> Void = { _ in }
    @ObservationIgnored private var observer: UUID?
    @ObservationIgnored private var snapshot: [TaskRow]?

    init(client: BridgeClient) {
        self.client = client
        observer = client.observe { [weak self] event in
            guard let self else { return }
            switch event {
            case .connected: Task { await self.subscribe() }
            case .tasks(let p): self.apply(p)
            default: break
            }
        }
    }

    var visible: [TaskRow] { TaskListLogic.filtered(tasks, repo: repoFilter) }
    /// Sections for the list under the chosen sort and search (the sort mode is a view-side `@AppStorage`).
    func projects(mode: TaskSortMode = .attention, query: String = "") -> [(repo: String, rows: [TaskRow])] {
        TaskListLogic.projects(visible, mode: mode, query: query, tabTitles: query.isEmpty ? [:] : tabTitles)
    }

    /// Task id → its tabs' titles, for search. Filled by `loadTabTitles` when the search opens.
    private(set) var tabTitles: [String: [String]] = [:]

    /// One `task.tabs` per task, concurrently; a task whose read fails just keeps no titles.
    func loadTabTitles() async {
        let ids = tasks.map(\.id)
        let client = client
        let loaded = await withTaskGroup(of: (String, [String])?.self) { group in
            for id in ids {
                group.addTask {
                    guard let r = try? await client.request("task.tabs", ["taskId": id], as: TabsResult.self) else { return nil }
                    return (id, r.tabs.map(\.displayTitle))
                }
            }
            var out: [String: [String]] = [:]
            for await pair in group { if let (id, titles) = pair { out[id] = titles } }
            return out
        }
        tabTitles = loaded
    }
    var repos: [String] { TaskListLogic.repos(tasks) }
    var attentionCount: Int { TaskListLogic.attentionCount(attention) }

    /// Locally-aged ms in the current activity state, nil without activity.
    func activityMs(_ row: TaskRow, now: Date) -> Double? {
        guard let a = row.activity else { return nil }
        return TaskListLogic.ageMs(forMs: a.forMs, receivedAt: receivedAt[row.id] ?? now, now: now)
    }

    func task(id: String) -> TaskRow? { tasks.first { $0.id == id } }

    func apply(_ p: TasksPayload) {
        for n in TransitionRule.notices(old: snapshot, new: p.tasks) { onNotice(n) }
        let now = Date()
        let old = Dictionary((snapshot ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var stamps: [String: Date] = [:]
        for r in p.tasks { stamps[r.id] = (old[r.id] == r ? receivedAt[r.id] : nil) ?? now }
        receivedAt = stamps
        snapshot = p.tasks
        tasks = p.tasks
        attention = p.attention
        loaded = true
        version += 1
        if let f = repoFilter, !repos.contains(f) { repoFilter = nil }
    }

    func subscribe() async {
        do { apply(try await client.request("tasks.subscribe", as: TasksPayload.self)) }
        catch { self.error = error.localizedDescription }
    }

    func refresh() async {
        do { apply(try await client.request("tasks.list", as: TasksPayload.self)); error = nil }
        catch { self.error = error.localizedDescription }
    }

    /// Back to the not-yet-loaded state (leaving demo mode): the next bridge's first snapshot must neither
    /// show demo rows nor be diffed against them for notifications.
    func reset() {
        tasks = []; attention = []; tabTitles = [:]
        loaded = false; error = nil; repoFilter = nil
        snapshot = nil; receivedAt = [:]
        version += 1
    }

    func dismissAttention(_ item: AttentionItem) async {
        guard let taskId = item.taskId else { return }
        var args: [String: Any] = ["taskId": taskId]
        if let tab = item.tabId { args["tabId"] = tab }
        _ = try? await client.request("attention.dismiss", args, as: EmptyResult.self)
        await refresh()
    }
}
