import Foundation

// Wire models and pure logic for the Board, Routines and GitHub Issues pages. Every optional
// field decodes to a default or nil, so an older or newer bridge never fails a whole list.

// MARK: - Issue store (Board)

enum IssueStatus: String, Codable, CaseIterable, Hashable {
    case open, doing, hold, done

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = IssueStatus(rawValue: raw) ?? .open
    }
}

/// One story of the issue store (`rove api issue-list`).
struct Story: Codable, Hashable, Identifiable {
    var id: Int
    var title: String
    var status: IssueStatus
    var created: String
    var body: String
    /// The linked task's id; set when a session was started from the story.
    var taskId: String?

    init(id: Int, title: String, status: IssueStatus = .open, created: String = "", body: String = "", taskId: String? = nil) {
        self.id = id; self.title = title; self.status = status; self.created = created; self.body = body; self.taskId = taskId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        status = try c.decodeIfPresent(IssueStatus.self, forKey: .status) ?? .open
        created = try c.decodeIfPresent(String.self, forKey: .created) ?? ""
        body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
        let link = try c.decodeIfPresent(String.self, forKey: .taskId)
        taskId = (link?.isEmpty ?? true) ? nil : link
    }

    var linked: Bool { taskId != nil }
    /// The body as shown: a description cleared from the phone is stored as one space.
    var detail: String { body.trimmingCharacters(in: .whitespacesAndNewlines) }
}

struct RepoIssues: Codable, Equatable {
    var repoRoot: String
    var exists: Bool
    var nextId: Int
    var issues: [Story]
    /// Records the store could not read; non-zero means `issues` is not the whole board.
    var skipped: Int

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        repoRoot = try c.decodeIfPresent(String.self, forKey: .repoRoot) ?? ""
        exists = try c.decodeIfPresent(Bool.self, forKey: .exists) ?? false
        nextId = try c.decodeIfPresent(Int.self, forKey: .nextId) ?? 1
        issues = try c.decodeIfPresent([Story].self, forKey: .issues) ?? []
        skipped = try c.decodeIfPresent(Int.self, forKey: .skipped) ?? 0
    }
}

struct IssueReposResult: Codable { var repos: [String] }
struct IssuePromptResult: Codable { var title: String; var prompt: String }

/// One row of a task's EVENTS snapshot: the engine lifecycle ring, newest first.
struct TaskEvent: Codable, Hashable {
    var kind: String
    var at: Double
    var tail: String

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        at = try c.decodeIfPresent(Double.self, forKey: .at) ?? 0
        tail = try c.decodeIfPresent(String.self, forKey: .tail) ?? ""
    }
}

struct TaskEventsResult: Codable { var events: [TaskEvent] }

enum BoardColumn: String, CaseIterable, Hashable {
    case backlog
    case inProgress = "in progress"
    case parked
    case done

    var title: String {
        switch self {
        case .backlog: String(localized: "backlog")
        case .inProgress: String(localized: "in progress")
        case .parked: String(localized: "parked")
        case .done: String(localized: "done")
        }
    }
}

struct BoardColumnData: Equatable {
    var key: BoardColumn
    var stories: [Story]
    /// Parked and Done accrete forever: the newest slice renders, the rest is `+N more`.
    var hiddenCount: Int
}

enum BoardLogic {
    static let cap = 20

    /// Terminal and parked outrank a link; a link (to a task that still exists) is In progress;
    /// an unlinked `doing` is In progress too; everything else is Backlog.
    /// Pass `taskExists: nil` while the task feed has not loaded, so the link alone decides.
    static func column(for story: Story, taskExists: ((String) -> Bool)?) -> BoardColumn {
        switch story.status {
        case .done: return .done
        case .hold: return .parked
        case .open, .doing:
            if let id = story.taskId, taskExists?(id) ?? true { return .inProgress }
            return story.status == .doing ? .inProgress : .backlog
        }
    }

    /// Newest-created first; id descending as the tiebreak (`created` is day-granular).
    static func newerFirst(_ a: Story, _ b: Story) -> Bool {
        a.created != b.created ? a.created > b.created : a.id > b.id
    }

    static func columns(_ stories: [Story], taskExists: ((String) -> Bool)?) -> [BoardColumnData] {
        var buckets: [BoardColumn: [Story]] = [:]
        for s in stories { buckets[column(for: s, taskExists: taskExists), default: []].append(s) }
        return BoardColumn.allCases.map { key in
            let sorted = (buckets[key] ?? []).sorted(by: newerFirst)
            let capped = key == .done || key == .parked
            guard capped, sorted.count > cap else { return BoardColumnData(key: key, stories: sorted, hiddenCount: 0) }
            return BoardColumnData(key: key, stories: Array(sorted.prefix(cap)), hiddenCount: sorted.count - cap)
        }
    }

    /// View-only: In-progress cards whose task needs a person float to the head (stable order) and
    /// are counted. Parked never floats: a blocked engine is often why a card was parked.
    static func floatingAttention(_ columns: [BoardColumnData], needsYou: (String) -> Bool) -> (columns: [BoardColumnData], count: Int) {
        var count = 0
        let next = columns.map { col -> BoardColumnData in
            guard col.key == .inProgress else { return col }
            let hot = col.stories.filter { $0.taskId.map(needsYou) ?? false }
            count = hot.count
            guard !hot.isEmpty else { return col }
            let hotIds = Set(hot.map(\.id))
            var out = col
            out.stories = hot + col.stories.filter { !hotIds.contains($0.id) }
            return out
        }
        return (next, count)
    }

    /// The same repo can arrive as `/tmp/x` and `/private/tmp/x`; compare on the resolved form.
    static func repoKey(_ path: String) -> String {
        for prefix in ["/private/tmp", "/private/var", "/private/etc"] where path == prefix || path.hasPrefix(prefix + "/") {
            return String(path.dropFirst("/private".count))
        }
        return path
    }

    /// Board project tabs: repos with an issue record, saved projects and repos with a live task, once each.
    static func projects(issueRepos: [String], knownRepos: [String]) -> [String] {
        var seen = Set<String>()
        return (issueRepos + knownRepos).filter { seen.insert(repoKey($0)).inserted }
    }

    /// Title a started session carries, the shape the TUI and web board use.
    static func sessionTitle(_ s: Story) -> String { "#\(s.id) \(s.title)" }
}

// MARK: - Routines

struct RoutinePrecheck: Codable, Hashable {
    var command: String
    var timeoutSeconds: Int?
}

struct RoutineRunResponse: Codable, Hashable {
    var text: String
    var at: String?
}

struct Routine: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var repo: String
    var prompt: String
    var schedule: String
    var enabled: Bool
    var nextRunAt: String?
    var vendor: String?
    var baseRef: String?
    var precheck: RoutinePrecheck?
    var persistentSession: Bool
    var missedRunGraceMinutes: Int?
    var lastOccurrenceAt: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? id
        repo = try c.decodeIfPresent(String.self, forKey: .repo) ?? ""
        prompt = try c.decodeIfPresent(String.self, forKey: .prompt) ?? ""
        schedule = try c.decodeIfPresent(String.self, forKey: .schedule) ?? ""
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        nextRunAt = try c.decodeIfPresent(String.self, forKey: .nextRunAt)
        vendor = try c.decodeIfPresent(String.self, forKey: .vendor)
        baseRef = try c.decodeIfPresent(String.self, forKey: .baseRef)
        precheck = try c.decodeIfPresent(RoutinePrecheck.self, forKey: .precheck)
        persistentSession = try c.decodeIfPresent(Bool.self, forKey: .persistentSession) ?? false
        missedRunGraceMinutes = try c.decodeIfPresent(Int.self, forKey: .missedRunGraceMinutes)
        lastOccurrenceAt = try c.decodeIfPresent(String.self, forKey: .lastOccurrenceAt)
    }

    var repoName: String { URL(fileURLWithPath: repo).lastPathComponent }
}

struct RoutinesPayload: Codable {
    var automations: [Routine]
    /// Latest run status per routine id, when the daemon sends it.
    var lastRunStatus: [String: String]
    var keepsDaemonAlive: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        automations = try c.decodeIfPresent([Routine].self, forKey: .automations) ?? []
        lastRunStatus = try c.decodeIfPresent([String: String].self, forKey: .lastRunStatus) ?? [:]
        keepsDaemonAlive = try c.decodeIfPresent(Bool.self, forKey: .keepsDaemonAlive) ?? false
    }
}

struct RoutineCreateResult: Codable { var automation: Routine }

struct RoutineRun: Codable, Hashable, Identifiable {
    var id: String
    var runNumber: Int
    var status: String
    var trigger: String
    var at: String
    var scheduledFor: String?
    var taskId: String?
    var tabId: String?
    var error: String?
    var response: RoutineRunResponse?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        runNumber = try c.decodeIfPresent(Int.self, forKey: .runNumber) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "unknown"
        trigger = try c.decodeIfPresent(String.self, forKey: .trigger) ?? "scheduled"
        at = try c.decodeIfPresent(String.self, forKey: .at) ?? ""
        scheduledFor = try c.decodeIfPresent(String.self, forKey: .scheduledFor)
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        tabId = try c.decodeIfPresent(String.self, forKey: .tabId)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        response = try c.decodeIfPresent(RoutineRunResponse.self, forKey: .response)
    }
}

struct RoutineRunsPayload: Codable {
    var runs: [RoutineRun]

    init(from decoder: Decoder) throws {
        runs = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent([RoutineRun].self, forKey: .runs) ?? []
    }
}

enum RoutineLogic {
    enum Tone { case success, muted, warning, error }

    /// The "didn't run" reasons stay distinct: `skipped_precheck` is healthy, `dispatch_failed` wants a human.
    static func tone(status: String) -> Tone {
        switch status {
        case "dispatched", "revived": .success
        case "skipped_missed", "skipped_unavailable": .warning
        case "dispatch_failed": .error
        default: .muted
        }
    }

    /// `skipped_precheck` → `skipped precheck`: the daemon's status ids, spaced.
    static func label(status: String) -> String {
        switch status {
        case "dispatched": String(localized: "dispatched")
        case "revived": String(localized: "revived")
        case "skipped_cancelled": String(localized: "skipped cancelled")
        case "skipped_precheck": String(localized: "skipped precheck")
        case "skipped_missed": String(localized: "skipped missed")
        case "skipped_unavailable": String(localized: "skipped unavailable")
        case "dispatch_failed": String(localized: "dispatch failed")
        default: status.replacingOccurrences(of: "_", with: " ")
        }
    }

    static func date(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    /// `in 3d`, `in 2h`, `in 14m`, `due` when it already passed; `—` without a time.
    static func until(_ iso: String?, now: Date) -> String {
        guard let d = date(iso) else { return "—" }
        let s = Int(d.timeIntervalSince(now))
        if s <= 0 { return String(localized: "due") }
        let age = TaskListLogic.age(ms: Double(s) * 1000)
        return String(localized: "in \(age)")
    }

    /// `3d ago`-style age of a past time.
    static func ago(_ iso: String?, now: Date) -> String {
        guard let d = date(iso) else { return "" }
        let age = TaskListLogic.age(ms: max(0, now.timeIntervalSince(d)) * 1000)
        return String(localized: "\(age) ago")
    }

    /// Five space-separated cron fields: the bridge refuses anything else, so refuse it here first.
    static func validSchedule(_ text: String) -> Bool {
        let fields = text.trimmingCharacters(in: .whitespaces).split(separator: " ", omittingEmptySubsequences: true)
        guard fields.count == 5 else { return false }
        let allowed = CharacterSet(charactersIn: "0123456789*/,-?#LWABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
        return fields.allSatisfy { f in f.unicodeScalars.allSatisfy(allowed.contains) }
    }
}

// MARK: - GitHub issues

struct WorkItem: Codable, Hashable, Identifiable {
    var number: Int
    var title: String
    var state: String
    var url: String
    var updatedAt: String
    var author: String?
    var labels: [String]

    var id: Int { number }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        number = try c.decode(Int.self, forKey: .number)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        state = try c.decodeIfPresent(String.self, forKey: .state) ?? ""
        url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        author = try c.decodeIfPresent(String.self, forKey: .author)
        labels = try c.decodeIfPresent([String].self, forKey: .labels) ?? []
    }
}

struct WorkItemsPayload: Codable { var items: [WorkItem] }
struct WorkItemLink: Codable, Hashable { var number: Int; var taskId: String }
struct WorkItemLinksPayload: Codable { var links: [WorkItemLink] }
struct WorkItemStartResult: Codable { var taskId: String }

enum WorkItemLogic {
    /// `gh` failures arrive as `kind: message` and name their fix.
    static func errorHint(_ message: String) -> String {
        let kind = message.range(of: ": ").map { String(message[..<$0.lowerBound]) } ?? ""
        switch kind {
        case "no-remote": return String(localized: "this repo has no github remote")
        case "gh-missing": return String(localized: "install the gh cli on the mac")
        case "auth": return String(localized: "run gh auth login on the mac")
        default: return message
        }
    }

    static func linkedTask(for item: WorkItem, in links: [WorkItemLink]) -> String? {
        links.first { $0.number == item.number }?.taskId
    }
}
