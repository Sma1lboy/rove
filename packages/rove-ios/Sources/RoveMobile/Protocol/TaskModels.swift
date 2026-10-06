import Foundation

// Codable models for the task-batch ops (contract: /tmp/rove-ios-par/tasks-contract.md).
// Every field the bridge may omit is optional or defaulted, so older bridges still decode.

/// `changes` on a task row, from the daemon's `worktree.changes` push. `unreadable` = tracked but git failed.
struct TaskChanges: Codable, Hashable {
    var added: Int?
    var deleted: Int?
    var ahead: Int?
    var behind: Int?
    var unreadable: Bool?

    var isUnreadable: Bool { unreadable == true }
    var hasLineCounts: Bool { (added ?? 0) > 0 || (deleted ?? 0) > 0 }
}

/// A live plugin row token (`rowTokens` on a task row). `expiresAt` is ms since epoch; filter on display.
struct RowTokenChip: Codable, Hashable {
    var text: String
    var tone: String?
    var source: String?
    var expiresAt: Double?

    func isLive(now: Date) -> Bool { expiresAt.map { $0 > now.timeIntervalSince1970 * 1000 } ?? true }
}

struct EngineModel: Codable, Hashable {
    var id: String
    var name: String?
}

// MARK: - task.get

struct TaskDetailPR: Codable, Hashable {
    var number: Int?
    var url: String?
    var lifecycle: String
    var checkState: String
    var reviewDecision: String?
    var mergeable: String?
    var baseRef: String?
}

struct TaskDetail: Codable, Hashable {
    var id: String
    var title: String
    var repo: String
    var branch: String
    var worktreePath: String
    var kind: String
    var status: String
    var pinned: Bool?
    var engine: String?
    var command: String?
    var model: String?
    var effort: String?
    var prompt: String?
    var baseRef: String?
    var groupId: String?
    var createdAt: String?
    var updatedAt: String?
    var pr: TaskDetailPR?
    var report: TaskReport?
}

struct TaskGetResult: Codable { var task: TaskDetail }

// MARK: - task.info (collect facts)

struct TabExit: Codable, Hashable {
    var code: Int?
    var signal: String?
    var cause: String?
}

struct TaskInfoTab: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var alive: Bool?
    var exit: TabExit?
    var tail: String?
}

struct TaskInfoChanges: Codable, Hashable { var added: Int; var deleted: Int }

struct TaskInfoBase: Codable, Hashable {
    var baseRef: String?
    var ahead: Int?
    var behind: Int?
}

struct TaskInfoResult: Codable {
    var taskId: String
    var running: Bool?
    var activity: TaskActivity?
    var changes: TaskInfoChanges?
    var base: TaskInfoBase?
    var tabs: [TaskInfoTab]
}

// MARK: - repo / notes / adopt / clone / spawn

struct BranchesResult: Codable { var branches: [String]; var current: String? }

struct FieldNote: Codable, Hashable, Identifiable {
    var id: Int
    var text: String
    var at: String?

    enum CodingKeys: String, CodingKey { case id, text, at }

    init(id: Int, text: String, at: String? = nil) { self.id = id; self.text = text; self.at = at }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        // `at` may be an ISO string or epoch number depending on the daemon; keep a display string.
        if let s = try? c.decodeIfPresent(String.self, forKey: .at) { at = s }
        else if let n = try? c.decodeIfPresent(Double.self, forKey: .at) { at = String(Int(n)) }
        else { at = nil }
    }
}

struct NotesResult: Codable { var notes: [FieldNote] }
struct NoteDeleteResult: Codable { var deleted: Bool }

struct AdoptableWorktree: Codable, Hashable, Identifiable {
    var path: String
    var branch: String?
    var head: String?
    var id: String { path }
}

struct AdoptableResult: Codable {
    var worktrees: [AdoptableWorktree]
    var unreadable: [String]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        worktrees = try c.decodeIfPresent([AdoptableWorktree].self, forKey: .worktrees) ?? []
        unreadable = try c.decodeIfPresent([String].self, forKey: .unreadable) ?? []
    }
}

struct SpawnResult: Codable { var taskIds: [String]; var groupId: String? }
struct OpenMainResult: Codable { var taskId: String }
struct AdoptResult: Codable { var taskId: String }
struct CloneResult: Codable { var path: String }
struct WorktreePathResult: Codable { var worktreePath: String }
struct RemoveWorktreeResult: Codable {
    var removed: Bool
    var worktreePath: String?
    var branch: String?
}

/// The six lifecycle labels `set-status` accepts, in TUI order.
enum TaskStatusLabel: String, CaseIterable, Identifiable {
    case backlog, inProgress = "in_progress", inReview = "in_review", done, canceled, error
    var id: String { rawValue }
    var label: String { rawValue.replacingOccurrences(of: "_", with: " ") }
}
