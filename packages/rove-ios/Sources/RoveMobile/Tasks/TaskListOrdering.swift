import Foundation

/// The list's sort modes, named as in the TUI (`TaskSortMode` in `sidebar/groups.ts`).
enum TaskSortMode: String, CaseIterable, Identifiable {
    /// What needs a person next: derived group rank, then server rank. The phone's resting order.
    case attention
    /// The daemon's own task order (`order`); what a manual move changes.
    case `default`
    /// `updatedAt` (else `createdAt`) descending.
    case recent
    /// Title A→Z, numbers numeric, case-insensitive.
    case name

    var id: String { rawValue }
    var label: String {
        switch self {
        case .attention: String(localized: "attention")
        case .default: String(localized: "default")
        case .recent: String(localized: "recent")
        case .name: String(localized: "name")
        }
    }
}

/// What the list shows in place of rows, if anything.
enum TaskListEmpty: Equatable {
    case none
    /// Loaded and the daemon has no tasks at all.
    case welcome
    /// Tasks exist, but the project filter / search hides every one.
    case noMatches
}

extension TaskListLogic {
    /// Rows in display order: search score first (only with a query), then `main`, pinned, the rest
    /// (the TUI's `buildRows` partition), then the mode's comparator, then list order.
    /// Pinned/`main` float across the whole list here; `projects` splits that per project.
    /// `tabTitles` (task id → its tabs' titles) widens a query to live tab titles, as the TUI's `/` does.
    static func sorted(_ rows: [TaskRow], mode: TaskSortMode = .attention, query: String = "",
                       tabTitles: [String: [String]] = [:]) -> [TaskRow] {
        rank(rows, mode: mode, query: query, tabTitles: tabTitles, floating: true)
    }

    /// One section per project (repo); rows keep `sorted` order.
    /// Project order follows the TUI for `default`/`recent`/`name`: the project's `main` task in stored
    /// order, then main-less projects first-seen. `attention` keeps the phone's own rule — most urgent
    /// task first (a deliberate difference: the TUI leaves project order alone in every mode).
    /// Project order is taken from ALL rows, so sections do not jump around while a search narrows.
    static func projects(_ rows: [TaskRow], mode: TaskSortMode = .attention, query: String = "",
                         tabTitles: [String: [String]] = [:]) -> [(repo: String, rows: [TaskRow])]
    {
        var out: [(repo: String, rows: [TaskRow])] = []
        var index: [String: Int] = [:]
        for r in sorted(rows, mode: mode, query: query, tabTitles: tabTitles) {
            if let i = index[r.repo] { out[i].rows.append(r) } else { index[r.repo] = out.count; out.append((r.repo, [r])) }
        }
        guard out.count > 1 else { return out }
        let position = Dictionary(projectOrder(rows, mode: mode).enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        return out.sorted { (position[$0.repo] ?? Int.max) < (position[$1.repo] ?? Int.max) }
    }

    static func emptiness(loaded: Bool, total: Int, shown: Int) -> TaskListEmpty {
        guard loaded else { return .none }
        if total == 0 { return .welcome }
        return shown == 0 ? .noMatches : .none
    }

    /// Seconds since epoch for the `recent` sort: `updatedAt`, else `createdAt`; 0 when absent or unparseable.
    static func recentTime(_ row: TaskRow) -> Double {
        let raw = [row.updatedAt, row.createdAt].compactMap { $0 }.first { !$0.isEmpty }
        return raw.flatMap(parseTimestamp) ?? 0
    }

    /// ISO8601 as the daemon writes it (`2026-07-01T00:00:00.000Z`), with or without fractional seconds.
    static func parseTimestamp(_ s: String) -> Double? {
        let date = (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(s))
            ?? (try? Date.ISO8601FormatStyle().parse(s))
        return date?.timeIntervalSince1970
    }

    // MARK: - Internals

    private typealias Entry = (offset: Int, row: TaskRow, score: Int)

    private static func rank(_ rows: [TaskRow], mode: TaskSortMode, query: String,
                             tabTitles: [String: [String]] = [:], floating: Bool) -> [TaskRow] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var entries: [Entry] = []
        for (i, r) in rows.enumerated() {
            if q.isEmpty { entries.append((i, r, 0)) }
            else if let s = RowSearch.score(q, r, tabTitles: tabTitles[r.id] ?? []) { entries.append((i, r, s)) }
        }
        entries.sort { a, b in
            if a.score != b.score { return a.score > b.score }
            if floating {
                let fa = floatRank(a.row), fb = floatRank(b.row)
                if fa != fb { return fa < fb }
            }
            let c = compare(a, b, mode)
            return c != 0 ? c < 0 : a.offset < b.offset
        }
        return entries.map(\.row)
    }

    /// `main` first (the TUI always pins it), then pinned, then the rest.
    private static func floatRank(_ r: TaskRow) -> Int { r.kind == "main" ? 0 : (r.pinned ? 1 : 2) }

    /// -1 / 0 / 1; 0 hands the decision to list order.
    private static func compare(_ a: Entry, _ b: Entry, _ mode: TaskSortMode) -> Int {
        switch mode {
        case .attention:
            if a.row.group.sortIndex != b.row.group.sortIndex { return a.row.group.sortIndex < b.row.group.sortIndex ? -1 : 1 }
            return three(a.row.rank, b.row.rank)
        case .default:
            // Rows the daemon gave no `order` sort after the ones it did, in list order.
            switch (a.row.order, b.row.order) {
            case let (x?, y?): return three(x, y)
            case (_?, nil): return -1
            case (nil, _?): return 1
            case (nil, nil): return 0
            }
        case .recent:
            let t = three(recentTime(b.row), recentTime(a.row))
            return t != 0 ? t : order(b.row.id.localizedCompare(a.row.id))
        case .name:
            let n = order(a.row.displayTitle.trimmingCharacters(in: .whitespaces)
                .localizedStandardCompare(b.row.displayTitle.trimmingCharacters(in: .whitespaces)))
            return n != 0 ? n : order(a.row.id.localizedCompare(b.row.id))
        }
    }

    private static func three<T: Comparable>(_ a: T, _ b: T) -> Int { a < b ? -1 : (a > b ? 1 : 0) }
    private static func order(_ c: ComparisonResult) -> Int { c == .orderedAscending ? -1 : (c == .orderedDescending ? 1 : 0) }

    private static func projectOrder(_ rows: [TaskRow], mode: TaskSortMode) -> [String] {
        var keys: [String] = []
        var seen = Set<String>()
        func add(_ repo: String) { if seen.insert(repo).inserted { keys.append(repo) } }
        if mode == .attention {
            rank(rows, mode: .attention, query: "", floating: false).forEach { add($0.repo) }
        } else {
            let stored = rank(rows, mode: .default, query: "", floating: false)
            stored.filter { $0.kind == "main" }.forEach { add($0.repo) }
            stored.forEach { add($0.repo) }
        }
        return keys
    }
}
