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

    var title: String {
        switch self {
        case .waitingOnYou: "Waiting on you"
        case .landing: "Landing"
        case .readyForReview: "Ready for review"
        case .working: "Working"
        case .idle: "Idle"
        case .unknown: "Other"
        }
    }
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

    init(id: String, title: String, branch: String = "", repo: String = "", kind: String = "task",
         status: String = "", group: TaskGroup, rank: Double = 0, activity: TaskActivity? = nil,
         engine: TaskEngine? = nil, pr: TaskPR? = nil, report: TaskReport? = nil, deleting: Bool = false) {
        self.id = id; self.title = title; self.branch = branch; self.repo = repo; self.kind = kind
        self.status = status; self.group = group; self.rank = rank; self.activity = activity
        self.engine = engine; self.pr = pr; self.report = report; self.deleting = deleting
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

    enum CodingKeys: String, CodingKey { case id, name, command, builtin, protocolName = "protocol" }
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
    init(tasks: [TaskRow], attention: [AttentionItem]) { self.tasks = tasks; self.attention = attention }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tasks = try c.decodeIfPresent([TaskRow].self, forKey: .tasks) ?? []
        attention = try c.decodeIfPresent([AttentionItem].self, forKey: .attention) ?? []
    }
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
struct DiffFileResult: Codable { var kind: String; var text: String?; var message: String? }
struct TermDataEvent: Codable { var stream: String; var data: String }
struct TermExitEvent: Codable { var stream: String; var code: Int? }
