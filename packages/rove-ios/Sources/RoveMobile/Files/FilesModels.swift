import Foundation

// Wire models for the files area. Every field the bridge may add later is optional, so an older
// bridge (no `truncated`, no `taskId`) and a newer one decode the same rows.

struct FilesListResult: Codable, Equatable {
    var files: [String]
    var truncated: Bool?
}

/// One review note, as the TUI stores it under `diffComments.<taskId>`.
struct ReviewNote: Codable, Identifiable, Equatable {
    var id: String
    var filePath: String
    var startLine: Int?
    var line: Int
    var body: String
    var createdAt: Double
    /// Set once the note reached the engine; unsent notes are the next send batch.
    var sentAt: Double?

    var isSent: Bool { sentAt != nil }
    var lineLabel: String { startLine.map { $0 != line ? "\($0)–\(line)" : "\(line)" } ?? "\(line)" }
}

struct ReviewListResult: Codable { var notes: [ReviewNote]; var unsent: Int? }
struct ReviewAddResult: Codable { var note: ReviewNote }
struct ReviewRemoveResult: Codable { var removed: Bool }
struct ReviewSendResult: Codable { var sent: Int; var delivered: Bool; var reason: String? }

/// `worktrees.list` row: the daemon's audit row plus the bridge's `taskId`/`taskKind` join.
struct WorktreeRow: Codable, Identifiable, Equatable {
    var path: String
    var branch: String
    var dirty: Bool?
    var roveManaged: Bool?
    var lastActivityMs: Double?
    var createdAtMs: Double?
    var branchOnRemote: Bool?
    var verdict: String?
    var verdictReason: String?
    var taskId: String?
    var taskKind: String?

    var id: String { path }
    /// Only a tracked task's own branch can land; an untracked or main/dir worktree cannot.
    var canLand: Bool { taskId != nil && (taskKind ?? "task") == "task" }
}

struct WorktreeProject: Codable, Identifiable, Equatable {
    var repo: String
    var worktrees: [WorktreeRow]
    var id: String { repo }
}

struct WorktreesResult: Codable { var projects: [WorktreeProject] }
struct WorktreeRemoveResult: Codable { var removed: Bool }

/// What `diff.file` sends for a hunkless patch (`PatchNote` in preview-core).
struct PatchNote: Codable, Equatable {
    var kind: String
    var from: String?
    var to: String?
    var change: String?
}
