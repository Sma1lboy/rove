import Foundation

// Pure logic behind the new-task sheet: no SwiftUI, no bridge. Everything here is unit-tested.

enum NewTaskMode: String, CaseIterable, Hashable {
    case existing, openProject, clone, adopt

    var label: String {
        switch self {
        case .existing: "existing"
        case .openProject: "open project"
        case .clone: "clone"
        case .adopt: "adopt"
        }
    }
}

// MARK: - agents plan (`claude:2,codex:1`)

enum AgentsPlan {
    /// The bridge/daemon cap on a fan-out.
    static let maxTotal = 10
    /// The count chip stops here (the TUI's chips).
    static let maxCount = 5

    static func total(_ counts: [String: Int]) -> Int { counts.values.reduce(0) { $0 + max($1, 0) } }

    /// `claude:2,codex:1`; zero counts are skipped, engines in `order` first, any others sorted after.
    static func string(_ counts: [String: Int], order: [String] = []) -> String {
        let known = order.filter { (counts[$0] ?? 0) > 0 }
        let extra = counts.keys.filter { (counts[$0] ?? 0) > 0 && !order.contains($0) }.sorted()
        return (known + extra).map { "\($0):\(counts[$0] ?? 0)" }.joined(separator: ",")
    }

    /// Non-empty and within the cap.
    static func isValid(_ counts: [String: Int]) -> Bool {
        let t = total(counts)
        return t >= 1 && t <= maxTotal
    }

    static func canIncrement(_ counts: [String: Int]) -> Bool { total(counts) < maxTotal }

    /// `engine`'s count moved by `delta`, floored at 0 and held under the total cap.
    static func adjusting(_ counts: [String: Int], engine: String, by delta: Int) -> [String: Int] {
        var next = counts
        let current = counts[engine] ?? 0
        let room = maxTotal - total(counts)
        let applied = delta > 0 ? min(delta, max(room, 0)) : max(delta, -current)
        let value = current + applied
        if value > 0 { next[engine] = value } else { next.removeValue(forKey: engine) }
        return next
    }
}

// MARK: - task.spawn

/// Everything the existing-repo form collects.
struct SpawnDraft: Equatable {
    var repo = ""
    var engine = ""
    var title = ""
    var prompt = ""
    var branch = ""
    var baseBranch = ""
    var model = ""
    var effort = ""
    var count = 1
    var agents: [String: Int] = [:]
    /// Engine order for the agents string.
    var engineOrder: [String] = []

    static func clampCount(_ n: Int) -> Int { min(max(n, 1), AgentsPlan.maxCount) }

    var promptText: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }
    var agentsString: String { AgentsPlan.string(agents, order: engineOrder) }
    var usesAgents: Bool { AgentsPlan.total(agents) > 0 }
    /// More than one task comes out of this draft.
    var isFanOut: Bool { usesAgents || SpawnDraft.clampCount(count) > 1 }
    var fanOutTotal: Int { usesAgents ? AgentsPlan.total(agents) : SpawnDraft.clampCount(count) }

    /// Why create is blocked, or nil.
    var blocker: String? {
        if repo.isEmpty { return "pick a repository" }
        if usesAgents && !AgentsPlan.isValid(agents) { return "agents: at most \(AgentsPlan.maxTotal) in total" }
        if isFanOut && promptText.isEmpty { return "fan-out needs a first prompt" }
        return nil
    }

    var canCreate: Bool { blocker == nil }

    /// `task.spawn` args. Empties are omitted; `agents` wins over `count`; a branch name only
    /// goes with a single task.
    func spawnArgs() -> [String: Any] {
        var a: [String: Any] = ["repo": repo]
        func put(_ key: String, _ value: String) {
            let v = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !v.isEmpty { a[key] = v }
        }
        put("engine", engine)
        put("title", title)
        if !promptText.isEmpty { a["prompt"] = prompt }
        put("baseBranch", baseBranch)
        put("model", model)
        put("effort", effort)
        if usesAgents {
            a["agents"] = agentsString
        } else if SpawnDraft.clampCount(count) > 1 {
            a["count"] = SpawnDraft.clampCount(count)
        }
        if !isFanOut { put("branch", branch) }
        return a
    }
}

// MARK: - clone

struct CloneDraft: Equatable {
    var url = ""
    var parentDir = ""
    private(set) var folder = ""
    private var folderEdited = false

    init(url: String = "", parentDir: String = "") {
        self.url = url
        self.parentDir = parentDir
        folder = CloneRules.deriveFolder(url)
    }

    /// Typing the url re-derives the folder until the folder is edited by hand.
    mutating func setURL(_ s: String) {
        url = s
        if !folderEdited { folder = CloneRules.deriveFolder(s) }
    }

    mutating func setFolder(_ s: String) {
        folder = s
        folderEdited = !s.isEmpty
    }

    var urlIssue: String? { CloneRules.urlIssue(url) }
    var parentIssue: String? { CloneRules.parentIssue(parentDir) }
    var folderIssue: String? { CloneRules.folderIssue(folder) }
    var isValid: Bool { urlIssue == nil && parentIssue == nil && folderIssue == nil }

    /// `repo.clone` args; `folder` only when set.
    func cloneArgs() -> [String: Any] {
        var a: [String: Any] = ["url": url.trimmingCharacters(in: .whitespacesAndNewlines),
                                "parentDir": parentDir.trimmingCharacters(in: .whitespacesAndNewlines)]
        let f = folder.trimmingCharacters(in: .whitespacesAndNewlines)
        if !f.isEmpty { a["folder"] = f }
        return a
    }
}

/// Soft, client-side checks. The bridge validates for real and its refusals are shown as-is.
enum CloneRules {
    private static let schemes: Set<String> = ["https", "http", "ssh", "git"]

    /// `https://github.com/foo/bar.git` → `bar`; scp form and trailing slashes handled.
    static func deriveFolder(_ url: String) -> String {
        var s = url.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        guard let tail = s.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) else { return "" }
        if tail.hasSuffix(".git"), tail.count > 4 { return String(tail.dropLast(4)) }
        return tail
    }

    static func urlIssue(_ raw: String) -> String? {
        let url = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if url.isEmpty { return "enter a git url" }
        if url.hasPrefix("-") || url.contains(where: \.isWhitespace) { return "that is not a git url" }
        if let r = url.range(of: "://") {
            let scheme = url[..<r.lowerBound].lowercased()
            let rest = url[r.upperBound...]
            guard schemes.contains(scheme) else { return "use https, ssh, git or user@host:path" }
            let host = rest.split(separator: "/", omittingEmptySubsequences: false).first.map(String.init) ?? ""
            let path = rest.dropFirst(host.count).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            return host.isEmpty || path.isEmpty ? "the url needs a host and a path" : nil
        }
        // scp form: [user@]host:path
        guard let colon = url.firstIndex(of: ":") else { return "use https, ssh, git or user@host:path" }
        let host = url[..<colon], path = url[url.index(after: colon)...]
        if host.isEmpty || host.contains("/") || path.isEmpty { return "use https, ssh, git or user@host:path" }
        return nil
    }

    static func parentIssue(_ raw: String) -> String? {
        let p = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if p.isEmpty { return "enter a parent directory" }
        return p.hasPrefix("/") ? nil : "parent must be an absolute path"
    }

    /// Empty is fine (the bridge derives it); otherwise a single path component.
    static func folderIssue(_ raw: String) -> String? {
        let f = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if f.isEmpty { return nil }
        if f.contains("/") { return "folder name cannot contain /" }
        if f == "." || f == ".." { return "folder name is not valid" }
        return nil
    }

    /// The parent directory of the first known repo.
    static func defaultParent(_ repos: [String]) -> String {
        guard let first = repos.first else { return "" }
        return URL(fileURLWithPath: first).deletingLastPathComponent().path
    }
}

// MARK: - adopt

/// Multi-select over adoptable worktree paths. `ordered` keeps the list's order for the sequential run.
struct AdoptSelection: Equatable {
    private(set) var selected: Set<String> = []

    var count: Int { selected.count }
    func contains(_ path: String) -> Bool { selected.contains(path) }

    mutating func toggle(_ path: String) {
        if selected.contains(path) { selected.remove(path) } else { selected.insert(path) }
    }

    mutating func set(_ path: String, on: Bool) {
        if on { selected.insert(path) } else { selected.remove(path) }
    }

    mutating func selectAll(_ paths: [String]) { selected = Set(paths) }
    mutating func clear() { selected = [] }

    /// Drop selections that are no longer in the list.
    mutating func keep(only paths: [String]) { selected.formIntersection(paths) }

    func ordered(_ paths: [String]) -> [String] { paths.filter(selected.contains) }

    static func progress(done: Int, total: Int) -> String { "\(min(done, total))/\(total)" }

    /// Last two path components: `…/worktrees/feat-x`.
    static func pathTail(_ path: String, parts: Int = 2) -> String {
        let comps = path.split(separator: "/").map(String.init)
        guard comps.count > parts else { return path }
        return "…/" + comps.suffix(parts).joined(separator: "/")
    }

    /// After the run: failures keep the sheet open; exactly one adopted opens it; otherwise dismiss.
    static func next(adopted: [String], failures: [String]) -> NewTaskFinish {
        if !failures.isEmpty { return .stay }
        return adopted.count == 1 ? .open(adopted[0]) : .dismiss
    }
}

/// What the sheet does once an action is done.
enum NewTaskFinish: Equatable { case stay, open(String), dismiss }

// MARK: - per-mode gate and branch order

enum NewTaskRules {
    static func canCreate(mode: NewTaskMode, spawn: SpawnDraft, clone: CloneDraft, adopt: AdoptSelection, busy: Bool = false) -> Bool {
        if busy { return false }
        switch mode {
        case .existing: return spawn.canCreate
        case .openProject: return !spawn.repo.isEmpty
        case .clone: return clone.isValid
        case .adopt: return !spawn.repo.isEmpty && adopt.count > 0
        }
    }

    /// Current branch first, rest in the given order.
    static func orderedBranches(_ branches: [String], current: String?) -> [String] {
        guard let current, branches.contains(current) else { return branches }
        return [current] + branches.filter { $0 != current }
    }

    /// The base to preselect: keep a still-valid choice, else the current branch, else the first.
    static func defaultBase(branches: [String], current: String?, keeping: String) -> String {
        if branches.contains(keeping) { return keeping }
        if let current, branches.contains(current) { return current }
        return branches.first ?? ""
    }
}
