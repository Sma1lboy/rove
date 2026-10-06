import Foundation

/// State of the new-task sheet and the bridge calls behind each mode. Pure rules live in `NewTaskLogic`.
@MainActor @Observable
final class NewTaskDraft {
    var mode: NewTaskMode = .existing
    var repos: [String] = []
    var engines: [Engine] = []
    var loadedLists = false
    var spawn = SpawnDraft()
    var clone = CloneDraft()
    var adopt = AdoptSelection()
    var adoptEngine = ""
    var branches: [String] = []
    var currentBranch: String?
    var adoptable: [AdoptableWorktree] = []
    var unreadable: [String] = []
    var adoptLoaded = false
    var optionsOpen = false
    var error: String?
    var notice: String?
    var busy = false
    /// `2/3` while adopting.
    var progress: String?

    var selectedEngine: Engine? { engines.first { $0.id == spawn.engine } }

    var canCreate: Bool {
        NewTaskRules.canCreate(mode: mode, spawn: spawn, clone: clone, adopt: adopt, busy: busy)
    }

    // MARK: loading

    func loadLists(client: BridgeClient, preferred: [String], lastEngine: String) async {
        do {
            repos = try await client.request("repos.list", as: ReposResult.self).repos
            engines = try await client.request("engines.list", as: EnginesResult.self).engines
            spawn.engineOrder = engines.map(\.id)
            if spawn.repo.isEmpty { spawn.repo = preferred.first { repos.contains($0) } ?? repos.first ?? "" }
            if spawn.engine.isEmpty {
                spawn.engine = engines.contains { $0.id == lastEngine } ? lastEngine : engines.first?.id ?? ""
            }
            if clone.parentDir.isEmpty { clone.parentDir = CloneRules.defaultParent(repos) }
            loadedLists = true
        } catch { self.error = error.localizedDescription }
    }

    /// `repo.branches` is served only for known repos; anything else just has no base picker.
    func loadBranches(client: BridgeClient) async {
        let repo = spawn.repo
        guard !repo.isEmpty else { return }
        let result = try? await client.request("repo.branches", ["repo": repo], as: BranchesResult.self)
        guard repo == spawn.repo else { return }
        branches = NewTaskRules.orderedBranches(result?.branches ?? [], current: result?.current)
        currentBranch = result?.current
        spawn.baseBranch = NewTaskRules.defaultBase(branches: branches, current: result?.current, keeping: spawn.baseBranch)
    }

    func loadAdoptable(client: BridgeClient) async {
        let repo = spawn.repo
        guard !repo.isEmpty else { return }
        adoptLoaded = false
        do {
            let r = try await client.request("worktree.adoptable", ["repo": repo], as: AdoptableResult.self)
            guard repo == spawn.repo else { return }
            adoptable = r.worktrees
            unreadable = r.unreadable
            adopt.keep(only: r.worktrees.map(\.path))
        } catch {
            guard repo == spawn.repo else { return }
            adoptable = []; unreadable = []
            self.error = error.localizedDescription
        }
        adoptLoaded = true
    }

    /// A model or effort chosen for another engine means nothing on this one.
    func engineChanged() {
        spawn.model = ""
        if !(selectedEngine?.effortLevels ?? []).contains(spawn.effort) { spawn.effort = "" }
    }

    // MARK: actions

    /// Run the action of the current mode.
    func perform(client: BridgeClient) async -> NewTaskFinish {
        switch mode {
        case .existing: await createSpawn(client: client)
        case .openProject: await openMain(client: client)
        case .clone: await runClone(client: client)
        case .adopt: await runAdopt(client: client)
        }
    }

    private func createSpawn(client: BridgeClient) async -> NewTaskFinish {
        busy = true; error = nil
        defer { busy = false }
        do {
            let r = try await client.request("task.spawn", spawn.spawnArgs(), timeout: spawn.isFanOut ? 120 : 30, as: SpawnResult.self)
            return r.taskIds.count == 1 ? .open(r.taskIds[0]) : .dismiss
        } catch { self.error = error.localizedDescription; return .stay }
    }

    private func openMain(client: BridgeClient) async -> NewTaskFinish {
        busy = true; error = nil
        defer { busy = false }
        do {
            let r = try await client.request("task.openMain", ["repo": spawn.repo], as: OpenMainResult.self)
            return .open(r.taskId)
        } catch { self.error = error.localizedDescription; return .stay }
    }

    /// Clone, then continue into the existing-repo form with the new path selected.
    private func runClone(client: BridgeClient) async -> NewTaskFinish {
        busy = true; error = nil; notice = nil
        defer { busy = false }
        do {
            let r = try await client.request("repo.clone", clone.cloneArgs(), timeout: 300, as: CloneResult.self)
            if let fresh = try? await client.request("repos.list", as: ReposResult.self).repos { repos = fresh }
            if !repos.contains(r.path) { repos.append(r.path) }
            spawn.repo = r.path
            notice = "cloned to \(r.path)"
            mode = .existing
        } catch { self.error = error.localizedDescription }
        return .stay
    }

    /// One `worktree.adopt` per selected worktree, in list order; failures are collected, the run keeps going.
    private func runAdopt(client: BridgeClient) async -> NewTaskFinish {
        busy = true; error = nil
        defer { busy = false; progress = nil }
        let paths = adopt.ordered(adoptable.map(\.path))
        var adopted: [String] = [], doneTasks: [String] = [], failures: [String] = []
        for (i, path) in paths.enumerated() {
            progress = AdoptSelection.progress(done: i + 1, total: paths.count)
            var args: [String: Any] = ["repo": spawn.repo, "worktreePath": path]
            if let branch = adoptable.first(where: { $0.path == path })?.branch, !branch.isEmpty { args["branch"] = branch }
            if !adoptEngine.isEmpty { args["engine"] = adoptEngine }
            do {
                let r = try await client.request("worktree.adopt", args, as: AdoptResult.self)
                adopted.append(r.taskId); doneTasks.append(path)
            } catch { failures.append("\(AdoptSelection.pathTail(path)): \(error.localizedDescription)") }
        }
        let next = AdoptSelection.next(adopted: adopted, failures: failures)
        if next == .stay {
            error = failures.joined(separator: "\n")
            adoptable.removeAll { doneTasks.contains($0.path) }
            adopt.keep(only: adoptable.map(\.path))
        }
        return next
    }
}
