import Foundation

/// Rank order (best-first) as defined by the bridge protocol.
enum TaskGroup: String, Codable, CaseIterable, Hashable {
    case waitingOnYou = "waiting-on-you"
    case landing
    case readyForReview = "ready-for-review"
    case working
    case idle
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TaskGroup(rawValue: raw) ?? .unknown
    }

    var sortIndex: Int { Self.allCases.firstIndex(of: self) ?? Self.allCases.count }
}

struct TaskActivity: Codable, Hashable {
    var state: String
    var forMs: Double
}

struct TaskEngine: Codable, Hashable {
    var id: String?
    var name: String
}

struct TaskPR: Codable, Hashable {
    var number: Int?
    var url: String?
    var lifecycle: String
    var checkState: String
    var reviewDecision: String?
    /// Additive: GitHub `mergeable` (`CONFLICTING` …), absent on older bridges.
    var mergeable: String?
}

struct TaskReport: Codable, Hashable {
    var summary: String
    var at: String?
}

struct TaskRow: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var branch: String
    var repo: String
    var kind: String
    var status: String
    var group: TaskGroup
    var rank: Double
    var activity: TaskActivity?
    var engine: TaskEngine?
    var pr: TaskPR?
    var report: TaskReport?
    var deleting: Bool
    // Additive optional fields (docs: tasks-batch contract). Absent on older bridges.
    var pinned: Bool
    /// Index in the daemon's own task list: the TUI's `default` sort.
    var order: Int?
    var createdAt: String?
    var updatedAt: String?
    var changes: TaskChanges?
    var rowTokens: [RowTokenChip]
    /// `conflict` / `failing` / `passing` (row-chips.ts `prChip`), nil when the row draws no PR chip.
    var prChip: String?
    var prChipStale: Bool

    init(id: String, title: String, branch: String = "", repo: String = "", kind: String = "task",
         status: String = "", group: TaskGroup, rank: Double = 0, activity: TaskActivity? = nil,
         engine: TaskEngine? = nil, pr: TaskPR? = nil, report: TaskReport? = nil, deleting: Bool = false,
         pinned: Bool = false, order: Int? = nil, createdAt: String? = nil, updatedAt: String? = nil,
         changes: TaskChanges? = nil, rowTokens: [RowTokenChip] = [], prChip: String? = nil, prChipStale: Bool = false) {
        self.id = id; self.title = title; self.branch = branch; self.repo = repo; self.kind = kind
        self.status = status; self.group = group; self.rank = rank; self.activity = activity
        self.engine = engine; self.pr = pr; self.report = report; self.deleting = deleting
        self.pinned = pinned; self.order = order; self.createdAt = createdAt; self.updatedAt = updatedAt
        self.changes = changes; self.rowTokens = rowTokens; self.prChip = prChip; self.prChipStale = prChipStale
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        branch = try c.decodeIfPresent(String.self, forKey: .branch) ?? ""
        repo = try c.decodeIfPresent(String.self, forKey: .repo) ?? ""
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "task"
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? ""
        group = try c.decodeIfPresent(TaskGroup.self, forKey: .group) ?? .unknown
        rank = try c.decodeIfPresent(Double.self, forKey: .rank) ?? 0
        activity = try c.decodeIfPresent(TaskActivity.self, forKey: .activity)
        engine = try c.decodeIfPresent(TaskEngine.self, forKey: .engine)
        pr = try c.decodeIfPresent(TaskPR.self, forKey: .pr)
        report = try c.decodeIfPresent(TaskReport.self, forKey: .report)
        deleting = try c.decodeIfPresent(Bool.self, forKey: .deleting) ?? false
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
        order = try c.decodeIfPresent(Int.self, forKey: .order)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        changes = try c.decodeIfPresent(TaskChanges.self, forKey: .changes)
        rowTokens = try c.decodeIfPresent([RowTokenChip].self, forKey: .rowTokens) ?? []
        prChip = try c.decodeIfPresent(String.self, forKey: .prChip)
        prChipStale = try c.decodeIfPresent(Bool.self, forKey: .prChipStale) ?? false
    }

    var repoName: String { URL(fileURLWithPath: repo).lastPathComponent }
    var displayTitle: String { title.isEmpty ? (branch.isEmpty ? id : branch) : title }
}

struct AttentionItem: Codable, Hashable {
    var taskId: String?
    var tabId: String?
    var state: String
    var unread: Bool
    var at: Double
    /// Rate-limited items: ISO time the daemon resumes the engine on its own. Absent from older bridges.
    var resumeAt: String?
    /// Routine items: the routine's name. Absent from older bridges.
    var label: String?
    /// `report_missing` items: the delivery id, the only key that can dismiss one. Absent from older bridges.
    var deliveryId: String?
    /// `decision_needed` items: the gate id, the key into `TasksPayload.gates`. A decision is answered, never dismissed.
    var gateId: String?
}

struct GateOption: Codable, Hashable {
    var key: String
    var label: String
    var detail: String?
}

/// A decision a task put to its owner: `open`, or `answered` with the engine not yet holding the answer.
struct GateRow: Codable, Hashable, Identifiable {
    var id: String
    var taskId: String
    var tabId: String?
    var question: String
    var options: [GateOption]
    var recommended: String?
    var context: String?
    var status: String
    var handoff: String?
    var createdAt: String
    /// The task's title.
    var label: String

    var isOpen: Bool { status == "open" }

    init(id: String, taskId: String, tabId: String? = nil, question: String, options: [GateOption] = [],
         recommended: String? = nil, context: String? = nil, status: String = "open", handoff: String? = nil,
         createdAt: String = "", label: String = "") {
        self.id = id; self.taskId = taskId; self.tabId = tabId; self.question = question; self.options = options
        self.recommended = recommended; self.context = context; self.status = status; self.handoff = handoff
        self.createdAt = createdAt; self.label = label
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        taskId = try c.decode(String.self, forKey: .taskId)
        tabId = try c.decodeIfPresent(String.self, forKey: .tabId)
        question = try c.decode(String.self, forKey: .question)
        options = try c.decodeIfPresent([GateOption].self, forKey: .options) ?? []
        recommended = try c.decodeIfPresent(String.self, forKey: .recommended)
        context = try c.decodeIfPresent(String.self, forKey: .context)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "open"
        handoff = try c.decodeIfPresent(String.self, forKey: .handoff)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
    }
}

struct TabRow: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var title: String?
    var engineName: String?
    var alive: Bool?
    var engineAlive: Bool?

    var displayTitle: String { title ?? engineName ?? kind }
}

struct Engine: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var command: String
    var protocolName: String
    var builtin: Bool
    /// Additive: what the engine can name for `--model` (suggestions); nil = unknown or older bridge.
    var models: [EngineModel]?
    /// Additive: reasoning-effort levels the engine declares; nil/empty = takes none.
    var effortLevels: [String]?
    /// Additive: installed and (where Rove can read it) signed in. nil on older bridges = unknown.
    var ready: Bool?

    enum CodingKeys: String, CodingKey { case id, name, command, builtin, models, effortLevels, ready, protocolName = "protocol" }
}

struct DiffFile: Codable, Hashable, Identifiable {
    var path: String
    var status: String
    var added: Int?
    var deleted: Int?
    var scope: String

    var id: String { scope + ":" + path }
}

// MARK: - Result payloads

struct HelloResult: Codable, Equatable { var protocolVersion: Int; var roveVersion: String; var host: String
    enum CodingKeys: String, CodingKey { case protocolVersion = "protocol", roveVersion, host }
}
struct TasksPayload: Codable, Equatable {
    var tasks: [TaskRow]
    var attention: [AttentionItem]
    /// Open decisions, and answered ones the engine has not received. Absent from older bridges.
    var gates: [GateRow]
    init(tasks: [TaskRow], attention: [AttentionItem], gates: [GateRow] = []) {
        self.tasks = tasks; self.attention = attention; self.gates = gates
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tasks = try c.decodeIfPresent([TaskRow].self, forKey: .tasks) ?? []
        attention = try c.decodeIfPresent([AttentionItem].self, forKey: .attention) ?? []
        gates = try c.decodeIfPresent([GateRow].self, forKey: .gates) ?? []
    }
}
/// `gate.answer`: whether the engine took the answer now (false = it rides the task's next message).
struct GateAnswerResult: Decodable {
    var delivered: Bool
    init(from decoder: Decoder) throws {
        delivered = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent(Bool.self, forKey: .delivered) ?? false
    }
    enum CodingKeys: String, CodingKey { case delivered }
}
struct EnginesResult: Codable { var engines: [Engine] }
struct ReposResult: Codable { var repos: [String] }
struct TaskCreateResult: Codable { var taskId: String }
struct TaskDeleteResult: Codable { var status: String }
struct TaskLandResult: Codable { var landedOn: String; var commit: String }
struct TabsResult: Codable { var tabs: [TabRow] }
struct TabNewResult: Codable { var tabId: String }
struct EmptyResult: Codable { init() {}; init(from decoder: Decoder) throws {} }
struct TermAttachResult: Codable { var stream: String; var alive: Bool; var replay: String }
struct DiffFilesResult: Codable { var base: String?; var files: [DiffFile] }
struct DiffFileResult: Codable, Equatable {
    var kind: String
    var text: String?
    var message: String?
    /// Rename source (`diff`), image flag and size (`binary`/`patch-note`), hunkless-patch detail.
    var origPath: String?
    var image: Bool?
    var sizeBytes: Int?
    var note: PatchNote?
}
struct TermDataEvent: Codable { var stream: String; var data: String }
struct TermExitEvent: Codable { var stream: String; var code: Int? }
