import Foundation

/// One tab the phone showed: the RECENT section's source (the TUI keeps the same log).
struct Visit: Codable, Hashable {
    var taskId: String
    var tabId: String?
    /// Epoch milliseconds.
    var at: Double
}

/// Ordering and wording for the Inbox, after `tui-react/workspace/attention-inbox-core.ts`.
enum InboxLogic {
    static let recentLimit = 5

    /// Stopped until a person acts: everything except a plain finished turn.
    static func isBlocking(_ item: AttentionItem) -> Bool { item.state != "turn_complete" }

    /// One episode per tab, the fresh one replacing the stale (same key as `attentionInboxItemKey`).
    static func key(_ item: AttentionItem) -> String {
        if item.taskId == nil, let label = item.label { return "\(item.state)\u{0}\(label)" }
        return "\(item.taskId ?? "")\u{0}\(item.tabId ?? "")"
    }

    /// Blocked episodes first, then oldest first within each band; task order and key break ties,
    /// so a stuck agent never waits behind finished turns.
    static func sorted(_ items: [AttentionItem], taskOrder: [String]) -> [AttentionItem] {
        let index = Dictionary(taskOrder.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        func band(_ i: AttentionItem) -> Int { isBlocking(i) ? 0 : 1 }
        func order(_ i: AttentionItem) -> Int { i.taskId.flatMap { index[$0] } ?? Int.max }
        return items.sorted { a, b in
            if band(a) != band(b) { return band(a) < band(b) }
            if a.at != b.at { return a.at < b.at }
            if order(a) != order(b) { return order(a) < order(b) }
            return key(a) < key(b)
        }
    }

    /// F7: the first pending item, or the one after `lastKey` so repeated presses walk the queue and
    /// wrap. Routine items have no task to open and are skipped.
    static func next(after lastKey: String?, in sortedItems: [AttentionItem]) -> AttentionItem? {
        let openable = sortedItems.filter { $0.taskId != nil }
        guard !openable.isEmpty else { return nil }
        guard let lastKey, let at = openable.firstIndex(where: { key($0) == lastKey }) else { return openable[0] }
        return openable[(at + 1) % openable.count]
    }

    /// The last tabs visited, newest first, one row per (task, tab). A target that already has a pending
    /// episode is not repeated (a task-level episode covers all its tabs), nor is a deleted task.
    static func recent(visits: [Visit], attention: [AttentionItem], taskIds: Set<String>, limit: Int = recentLimit) -> [Visit] {
        var seen = Set<String>()
        var out: [Visit] = []
        for v in visits.sorted(by: { $0.at > $1.at }) {
            guard taskIds.contains(v.taskId) else { continue }
            let k = "\(v.taskId)\u{0}\(v.tabId ?? "")"
            guard seen.insert(k).inserted else { continue }
            let covered = attention.contains { $0.taskId == v.taskId && ($0.tabId == nil || $0.tabId == v.tabId) }
            if covered { continue }
            out.append(v)
            if out.count == limit { break }
        }
        return out
    }

    /// Fold a visit into the log: newest per target kept, capped so the log stays small.
    static func appending(_ visit: Visit, to visits: [Visit], cap: Int = 30) -> [Visit] {
        let same = { (v: Visit) in v.taskId == visit.taskId && v.tabId == visit.tabId }
        return Array(([visit] + visits.filter { !same($0) }).prefix(cap))
    }

    static func stateWord(_ state: String) -> String {
        switch state {
        case "permission_needed": "permission"
        case "rate_limited": "rate limit"
        case "error": "error"
        case "dead": "exited"
        case "turn_complete": "done"
        case "routine_failed": "routine failed"
        case "routine_responded": "routine replied"
        default: state.replacingOccurrences(of: "_", with: " ")
        }
    }

    /// The tab-strip glyph that goes with the word.
    static func glyph(_ state: String) -> String {
        switch state {
        case "permission_needed": "?"
        case "rate_limited": "◷"
        case "error", "routine_failed": "!"
        case "dead": "†"
        case "turn_complete": "●"
        default: "○"
        }
    }

    /// `resumes 3:14 PM` (with the day when it is not today); nil without a usable time.
    static func resumeLabel(iso: String?, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String? {
        guard let iso, let date = parseISO(iso) else { return nil }
        let f = DateFormatter()
        f.locale = locale
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        if calendar.isDate(date, inSameDayAs: now) { f.timeStyle = .short; f.dateStyle = .none }
        else { f.setLocalizedDateFormatFromTemplate("MMM d jmm") }
        // ICU puts a narrow no-break space before AM/PM; the mono face shows it as a gap.
        return "resumes \(f.string(from: date).replacingOccurrences(of: "\u{202F}", with: " "))"
    }

    static func parseISO(_ s: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
}
