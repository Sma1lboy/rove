import Foundation

/// A mono tag on a worktree row: text plus how loudly to show it.
struct WorktreeTag: Equatable {
    enum Tone: Equatable { case quiet, good, warn }
    var text: String
    var tone: Tone
}

enum WorktreesLogic {
    /// Compact age: `5m`, `3h`, `12d`, `7mo`. `nil` when the daemon had no timestamp (0 / missing).
    static func age(ms: Double?, now: Date = Date()) -> String? {
        guard let ms, ms > 0 else { return nil }
        let s = max(0, now.timeIntervalSince1970 - ms / 1000)
        switch s {
        case ..<3600: return "\(max(1, Int(s / 60)))m"
        case ..<86_400: return "\(Int(s / 3600))h"
        case ..<(86_400 * 60): return "\(Int(s / 86_400))d"
        default: return "\(Int(s / (86_400 * 30)))mo"
        }
    }

    /// The row's badges: dirty (or a failed probe), remote, and the staleness verdict when it says more.
    static func tags(_ row: WorktreeRow) -> [WorktreeTag] {
        var out: [WorktreeTag] = []
        if row.roveManaged == true { out.append(WorktreeTag(text: "rove", tone: .quiet)) }
        switch row.dirty {
        case true: out.append(WorktreeTag(text: "dirty", tone: .warn))
        case nil: out.append(WorktreeTag(text: "dirty?", tone: .quiet)) // probe failed: not the same as clean
        default: break
        }
        // `.some(true)`/`.some(false)`/`.none`: older compilers don't see literal Bool patterns on Optional as exhaustive.
        switch row.branchOnRemote {
        case .some(true): out.append(WorktreeTag(text: "on remote", tone: .good))
        case .some(false): out.append(WorktreeTag(text: "not pushed", tone: .warn))
        case .none: out.append(WorktreeTag(text: "remote ?", tone: .quiet))
        }
        if let v = verdictLabel(row) { out.append(v) }
        return out
    }

    /// `dirty` and `fresh` already read from other tags; the rest explain why a row looks stale or done.
    static func verdictLabel(_ row: WorktreeRow) -> WorktreeTag? {
        switch row.verdictReason {
        case "prOpen": return WorktreeTag(text: "PR open", tone: .quiet)
        case "prMerged": return WorktreeTag(text: "PR merged", tone: .good)
        case "inMain": return WorktreeTag(text: "in main", tone: .good)
        case "prClosed": return WorktreeTag(text: "PR closed", tone: .warn)
        case "idle": return WorktreeTag(text: "idle", tone: .warn)
        default: return nil
        }
    }

    static func projectName(_ repo: String) -> String { (repo as NSString).lastPathComponent }
}
