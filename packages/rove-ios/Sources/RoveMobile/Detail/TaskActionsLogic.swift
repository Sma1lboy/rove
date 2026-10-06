import Foundation

/// Pure decisions behind the task action menus and sheets: no views, no network, all testable.
enum TaskActionLogic {
    // MARK: - Kind-aware delete

    /// The four destructive flows. `removeEntry` is deleting a `kind: "dir"` row (the directory stays).
    enum Flow: Equatable {
        case deleteTask, removeEntry, forgetProject, removeWorktree

        /// The bridge op the final confirmation calls.
        var op: String {
            switch self {
            case .deleteTask, .removeEntry: "task.delete"
            case .forgetProject: "project.forget"
            case .removeWorktree: "task.removeWorktree"
            }
        }
    }

    /// Copy and behavior for one destructive flow: the first confirmation (menu → dialog), the red sheet,
    /// and, when the bridge refuses a dirty worktree, the second destructive confirmation that forces.
    struct ConfirmPlan: Equatable {
        var flow: Flow
        var menuTitle: String
        var menuSymbol: String
        var dialogTitle: String
        var dialogMessage: String
        var dialogButton: String
        var sheetTitle: String
        var kicker: String
        var body: String
        var hint: String?
        var confirmLabel: String
        /// Label of the up-front "discard uncommitted changes" toggle; nil when the flow has none.
        var forceToggleLabel: String?
        /// A dirty-worktree refusal asks again (and retries with `force`) only for flows that touch a worktree.
        var retriesWithForce: Bool
        var forceTitle: String
        var forceBody: String
        var forceLabel: String
    }

    static let dirtyForceBody = "Forcing takes a salvage snapshot of the uncommitted changes first (refs/rove/salvage), then removes the worktree."

    static func deletePlan(kind: String) -> ConfirmPlan {
        switch kind {
        case "main":
            return forgetProjectPlan(menuTitle: "Forget project", dialogTitle: "Forget this project?")
        case "dir":
            return ConfirmPlan(
                flow: .removeEntry, menuTitle: "Remove entry", menuSymbol: "trash",
                dialogTitle: "Remove this entry?", dialogMessage: "Removes the entry only — your directory stays.",
                dialogButton: "Remove…",
                sheetTitle: "remove this entry?", kicker: "remove entry",
                body: "Removes the entry from Rove only. Your directory and everything in it stays where it is.",
                hint: nil, confirmLabel: "remove entry",
                forceToggleLabel: nil, retriesWithForce: false,
                forceTitle: "", forceBody: "", forceLabel: "")
        default:
            return ConfirmPlan(
                flow: .deleteTask, menuTitle: "Delete task", menuSymbol: "trash",
                dialogTitle: "Delete this task?", dialogMessage: "Removes the task and its worktree.",
                dialogButton: "Delete…",
                sheetTitle: "delete this task?", kicker: "delete",
                body: "Removes the task and its worktree. The git branch stays, so committed work is not lost.",
                hint: "Without this, a worktree with uncommitted changes is refused.", confirmLabel: "delete task",
                forceToggleLabel: "Also discard uncommitted changes", retriesWithForce: true,
                forceTitle: "uncommitted changes", forceBody: dirtyForceBody, forceLabel: "discard changes and delete")
        }
    }

    /// Forgetting a project (from its header, or from its main row).
    static func forgetProjectPlan(menuTitle: String = "Remove project", dialogTitle: String = "Remove this project?") -> ConfirmPlan {
        ConfirmPlan(
            flow: .forgetProject, menuTitle: menuTitle, menuSymbol: "trash",
            dialogTitle: dialogTitle, dialogMessage: "Rove stops listing it. The repo and its tasks stay on disk.",
            dialogButton: "Forget…",
            sheetTitle: "forget this project?", kicker: "forget project",
            body: "Rove stops tracking this project. The repo and its tasks stay on disk, and adding the folder again brings it back.",
            hint: nil, confirmLabel: "forget project",
            forceToggleLabel: nil, retriesWithForce: false,
            forceTitle: "", forceBody: "", forceLabel: "")
    }

    static func removeWorktreePlan() -> ConfirmPlan {
        ConfirmPlan(
            flow: .removeWorktree, menuTitle: "Remove worktree", menuSymbol: "folder.badge.minus",
            dialogTitle: "Remove this worktree?", dialogMessage: "Keeps the task and its branch.",
            dialogButton: "Remove…",
            sheetTitle: "remove this worktree?", kicker: "remove worktree",
            body: "Removes the worktree directory only. The task and its git branch stay, and creating the worktree again brings the files back.",
            hint: "A worktree with uncommitted changes is refused until you confirm again.", confirmLabel: "remove worktree",
            forceToggleLabel: nil, retriesWithForce: true,
            forceTitle: "uncommitted changes", forceBody: dirtyForceBody, forceLabel: "discard changes and remove")
    }

    /// The args for the plan's final op. `force` only rides on flows that retry with it.
    static func args(for plan: ConfirmPlan, taskId: String?, repo: String?, force: Bool) -> [String: Any] {
        switch plan.flow {
        case .forgetProject:
            return ["repo": repo ?? ""]
        case .deleteTask, .removeEntry, .removeWorktree:
            var a: [String: Any] = ["taskId": taskId ?? ""]
            if force && plan.retriesWithForce { a["force"] = true }
            return a
        }
    }

    /// The bridge answers a dirty worktree with `DIRTY_WORKTREE` (code or message prefix) naming what would be lost.
    static func isDirtyRefusal(_ error: Error) -> Bool {
        guard let e = error as? BridgeError else { return false }
        if e.code.uppercased() == "DIRTY_WORKTREE" { return true }
        let m = e.message.lowercased()
        return m.contains("dirty_worktree") || m.contains("uncommitted") || m.contains("dirty")
    }

    /// What the refusal says, minus the `DIRTY_WORKTREE:` code prefix.
    static func dirtyDetail(_ error: Error) -> String {
        guard let e = error as? BridgeError else { return error.localizedDescription }
        var m = e.message
        if let r = m.range(of: "DIRTY_WORKTREE") {
            m = String(m[r.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: ": \n"))
        }
        return m.isEmpty ? "the worktree holds uncommitted changes" : m
    }

    // MARK: - Status

    /// Tolerant mapping of a row's raw status (`in_progress`, `in-progress`, `In progress`) to a label.
    static func statusLabel(_ raw: String) -> TaskStatusLabel? {
        let key = raw.trimmingCharacters(in: .whitespaces).lowercased()
            .replacingOccurrences(of: "-", with: "_").replacingOccurrences(of: " ", with: "_")
        return TaskStatusLabel(rawValue: key)
    }

    // MARK: - Engine / model / effort

    /// The engine row a task runs: by engine id first, then by launch command.
    static func engine(detail: TaskDetail?, rowEngineId: String? = nil, in engines: [Engine]) -> Engine? {
        for id in [detail?.engine, rowEngineId] {
            if let id, !id.isEmpty, let e = engines.first(where: { $0.id == id }) { return e }
        }
        if let command = detail?.command, !command.isEmpty {
            let stem = commandStem(command)
            return engines.first { $0.command == command || $0.id == command }
                ?? engines.first { commandStem($0.command) == stem }
        }
        return nil
    }

    private static func commandStem(_ command: String) -> String {
        let first = command.split(separator: " ").first.map(String.init) ?? command
        return (first as NSString).lastPathComponent
    }

    /// Effort levels the engine declares; empty hides the effort control.
    static func effortLevels(_ engine: Engine?) -> [String] {
        var seen = Set<String>()
        return (engine?.effortLevels ?? []).filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    /// Model suggestions from the engine (`models` are suggestions, not a closed list).
    static func modelSuggestions(_ engine: Engine?) -> [EngineModel] {
        var seen = Set<String>()
        return (engine?.models ?? []).filter { !$0.id.isEmpty && seen.insert($0.id).inserted }
    }

    // MARK: - Inputs

    /// A trimmed title the bridge will take (non-empty, ≤ 200), else nil.
    static func validTitle(_ raw: String) -> String? {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty || t.count > 200 ? nil : t
    }

    /// Cheap client-side check of `git check-ref-format` basics; the bridge is the authority.
    static func validBranch(_ raw: String) -> String? {
        let b = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !b.isEmpty, !b.hasPrefix("-"), !b.hasPrefix("/"), !b.hasSuffix("/"), !b.hasSuffix("."),
              !b.hasSuffix(".lock"), !b.contains(".."), !b.contains("//"), !b.contains("@{"), b != "@" else { return nil }
        let banned = CharacterSet(charactersIn: " ~^:?*[\\").union(.controlCharacters)
        return b.rangeOfCharacter(from: banned) == nil ? b : nil
    }

    // MARK: - Menu

    struct PinItem: Equatable {
        var title: String
        var symbol: String
        /// The `pinned` value the tap sends.
        var next: Bool
    }

    static func pinItem(pinned: Bool) -> PinItem {
        pinned ? PinItem(title: "Unpin", symbol: "pin.slash", next: false) : PinItem(title: "Pin to top", symbol: "pin", next: true)
    }

    enum RunAgain: Equatable {
        case hidden
        case available
        case unavailable(String)
    }

    /// `detail == nil` = not fetched yet: offer it, the tap re-checks.
    static func runAgain(kind: String, detail: TaskDetail?) -> RunAgain {
        guard kind != "main", kind != "dir" else { return .hidden }
        if let detail, runAgainArgs(detail) == nil { return .unavailable("no stored prompt") }
        return .available
    }

    /// `task.spawn` args that repeat a task: same repo, prompt, engine and title. Nil without a stored prompt.
    static func runAgainArgs(_ d: TaskDetail) -> [String: Any]? {
        guard let prompt = d.prompt?.trimmingCharacters(in: .whitespacesAndNewlines), !prompt.isEmpty, !d.repo.isEmpty else { return nil }
        var a: [String: Any] = ["repo": d.repo, "prompt": prompt]
        if let e = d.engine, !e.isEmpty { a["engine"] = e }
        if !d.title.isEmpty { a["title"] = d.title }
        return a
    }

    struct MenuPlan: Equatable {
        var branch: Bool
        var move: Bool
        var copyBranch: Bool
        var copyPath: Bool
        var runAgain: RunAgain
        var createWorktree: Bool
        var removeWorktree: Bool
        var pin: PinItem
        var delete: ConfirmPlan

        var showsCopyGroup: Bool { copyBranch || copyPath || runAgain != .hidden }
        var showsWorktreeGroup: Bool { createWorktree || removeWorktree }
    }

    /// Which items the menu shows. `detail` is the cached `task.get` (nil until fetched).
    static func menu(kind: String, pinned: Bool, branch: String, detail: TaskDetail?) -> MenuPlan {
        let managed = kind != "main" && kind != "dir"
        let path = detail?.worktreePath.trimmingCharacters(in: .whitespaces)
        // Unknown worktree state offers both; the tap re-reads the truth.
        let hasWorktree = path.map { !$0.isEmpty }
        return MenuPlan(
            branch: managed,
            move: kind != "main",
            copyBranch: !(detail?.branch ?? branch).isEmpty,
            copyPath: hasWorktree ?? true,
            runAgain: runAgain(kind: kind, detail: detail),
            createWorktree: managed && hasWorktree != true,
            removeWorktree: managed && hasWorktree != false,
            pin: pinItem(pinned: pinned),
            delete: deletePlan(kind: kind))
    }

    // MARK: - Info sheet text

    struct InfoLine: Equatable {
        var label: String
        var value: String
    }

    /// PR facts from `task.get`.pr, one mono line each.
    static func prLines(_ pr: TaskDetailPR) -> [InfoLine] {
        var out: [InfoLine] = []
        if let n = pr.number { out.append(InfoLine(label: "pr", value: "#\(n)")) }
        out.append(InfoLine(label: "lifecycle", value: pr.lifecycle))
        out.append(InfoLine(label: "checks", value: pr.checkState))
        out.append(InfoLine(label: "review", value: pr.reviewDecision.flatMap { $0.isEmpty ? nil : $0.lowercased() } ?? "none"))
        out.append(InfoLine(label: "mergeable", value: pr.mergeable.flatMap { $0.isEmpty ? nil : $0.lowercased() } ?? "unknown"))
        if let b = pr.baseRef, !b.isEmpty { out.append(InfoLine(label: "base", value: b)) }
        return out
    }

    /// Uncommitted lines, `+N −N`; "clean" at zero, "unknown" when not collected.
    static func uncommittedLine(_ c: TaskInfoChanges?) -> String {
        guard let c else { return "unknown" }
        return c.added == 0 && c.deleted == 0 ? "clean" : "+\(c.added) −\(c.deleted)"
    }

    /// Committed work against the base: `↑2 ahead · ↓0 behind · main`.
    static func baseLine(_ b: TaskInfoBase?) -> String {
        guard let b else { return "unknown" }
        var parts: [String] = []
        if let a = b.ahead { parts.append("↑\(a) ahead") }
        if let d = b.behind { parts.append("↓\(d) behind") }
        if let r = b.baseRef, !r.isEmpty { parts.append(r) }
        return parts.isEmpty ? "unknown" : parts.joined(separator: " · ")
    }

    static func runningLine(_ running: Bool?) -> String {
        switch running {
        case true?: "yes"
        case false?: "no"
        case nil: "unknown"
        }
    }

    static func activityLine(_ a: TaskActivity?) -> String {
        guard let a else { return "none" }
        return "\(a.state) · \(TaskListLogic.clock(ms: a.forMs))"
    }

    /// `running`, or `exited · cause · code 1 · signal SIGTERM` for a dead tab.
    static func tabState(_ tab: TaskInfoTab) -> String {
        switch tab.alive {
        case true?: return "running"
        case nil: return "unknown"
        case false?:
            var parts = ["exited"]
            if let c = tab.exit?.cause, !c.isEmpty { parts.append(c) }
            if let code = tab.exit?.code { parts.append("code \(code)") }
            if let s = tab.exit?.signal, !s.isEmpty { parts.append("signal \(s)") }
            return parts.joined(separator: " · ")
        }
    }

    /// An output tail without trailing blank lines; nil when there is nothing to show.
    static func tailText(_ tab: TaskInfoTab) -> String? {
        guard let t = tab.tail?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }
}
