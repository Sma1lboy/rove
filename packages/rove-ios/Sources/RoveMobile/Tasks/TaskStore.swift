import Foundation
import Observation

enum TaskListLogic {
    /// Group order first (rank order), then server rank, then original order.
    static func sorted(_ rows: [TaskRow]) -> [TaskRow] {
        rows.enumerated().sorted { a, b in
            if a.element.group.sortIndex != b.element.group.sortIndex { return a.element.group.sortIndex < b.element.group.sortIndex }
            if a.element.rank != b.element.rank { return a.element.rank < b.element.rank }
            return a.offset < b.offset
        }.map(\.element)
    }

    static func sections(_ rows: [TaskRow]) -> [(group: TaskGroup, rows: [TaskRow])] {
        let s = sorted(rows)
        var out: [(group: TaskGroup, rows: [TaskRow])] = []
        for r in s {
            if let i = out.indices.last, out[i].group == r.group { out[i].rows.append(r) } else { out.append((r.group, [r])) }
        }
        return out
    }

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
    var sections: [(group: TaskGroup, rows: [TaskRow])] { TaskListLogic.sections(visible) }
    var repos: [String] { TaskListLogic.repos(tasks) }
    var attentionCount: Int { TaskListLogic.attentionCount(attention) }

    /// Locally-aged activity text ("working · 3m"), nil without activity.
    func activityText(_ row: TaskRow, now: Date) -> String? {
        guard let a = row.activity else { return nil }
        let ms = TaskListLogic.ageMs(forMs: a.forMs, receivedAt: receivedAt[row.id] ?? now, now: now)
        return "\(a.state) · \(TaskListLogic.age(ms: ms))"
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

    func dismissAttention(_ item: AttentionItem) async {
        guard let taskId = item.taskId else { return }
        var args: [String: Any] = ["taskId": taskId]
        if let tab = item.tabId { args["tabId"] = tab }
        _ = try? await client.request("attention.dismiss", args, as: EmptyResult.self)
        await refresh()
    }
}
