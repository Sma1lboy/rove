import XCTest
@testable import RoveMobile

final class NewTaskTests: XCTestCase {
    private func draft(_ edit: (inout SpawnDraft) -> Void = { _ in }) -> SpawnDraft {
        var d = SpawnDraft()
        d.repo = "/r/app"
        d.engineOrder = ["claude", "codex"]
        edit(&d)
        return d
    }

    // MARK: task.spawn args

    func testSpawnArgsOmitEmpties() {
        let a = draft { $0.title = "  "; $0.prompt = "\n " }.spawnArgs()
        XCTAssertEqual(Set(a.keys), ["repo"])
    }

    func testSpawnArgsCarryFilledFields() {
        let a = draft {
            $0.engine = "codex"; $0.title = "t"; $0.prompt = "go"; $0.branch = "feat/x"
            $0.baseBranch = "main"; $0.model = "m1"; $0.effort = "high"
        }.spawnArgs()
        XCTAssertEqual(a["engine"] as? String, "codex")
        XCTAssertEqual(a["branch"] as? String, "feat/x")
        XCTAssertEqual(a["baseBranch"] as? String, "main")
        XCTAssertEqual(a["model"] as? String, "m1")
        XCTAssertEqual(a["effort"] as? String, "high")
        XCTAssertNil(a["count"]); XCTAssertNil(a["agents"])
    }

    func testCountOneIsOmittedAndCountClamps() {
        XCTAssertNil(draft { $0.count = 1 }.spawnArgs()["count"])
        XCTAssertEqual(draft { $0.count = 3; $0.prompt = "p" }.spawnArgs()["count"] as? Int, 3)
        XCTAssertEqual(draft { $0.count = 99; $0.prompt = "p" }.spawnArgs()["count"] as? Int, 5)
        XCTAssertNil(draft { $0.count = -4 }.spawnArgs()["count"])
    }

    func testAgentsWinOverCountAndDropBranch() {
        let a = draft { $0.count = 4; $0.agents = ["codex": 1, "claude": 2]; $0.prompt = "p"; $0.branch = "b" }.spawnArgs()
        XCTAssertEqual(a["agents"] as? String, "claude:2,codex:1")
        XCTAssertNil(a["count"])
        XCTAssertNil(a["branch"])
    }

    func testBranchDroppedForCountFanOut() {
        XCTAssertNil(draft { $0.count = 2; $0.prompt = "p"; $0.branch = "b" }.spawnArgs()["branch"])
        XCTAssertEqual(draft { $0.branch = "b" }.spawnArgs()["branch"] as? String, "b")
    }

    // MARK: agents plan

    func testAgentsStringOrderAndZeroSkipping() {
        XCTAssertEqual(AgentsPlan.string(["codex": 1, "claude": 2, "pi": 0], order: ["claude", "codex", "pi"]), "claude:2,codex:1")
        XCTAssertEqual(AgentsPlan.string(["zed": 1, "amp": 1], order: ["claude"]), "amp:1,zed:1")
        XCTAssertEqual(AgentsPlan.string([:]), "")
    }

    func testAgentsTotalCapAndValidation() {
        XCTAssertFalse(AgentsPlan.isValid([:]))
        XCTAssertTrue(AgentsPlan.isValid(["a": 6, "b": 4]))
        XCTAssertFalse(AgentsPlan.isValid(["a": 6, "b": 5]))
        let capped = AgentsPlan.adjusting(["a": 6, "b": 3], engine: "b", by: 5)
        XCTAssertEqual(capped["b"], 4)
        XCTAssertFalse(AgentsPlan.canIncrement(capped))
    }

    func testAgentsAdjustFloorsAtZeroAndRemovesEntry() {
        XCTAssertEqual(AgentsPlan.adjusting(["a": 1], engine: "a", by: -3), [:])
        XCTAssertEqual(AgentsPlan.adjusting([:], engine: "a", by: 1), ["a": 1])
    }

    // MARK: clone

    func testFolderDerivation() {
        XCTAssertEqual(CloneRules.deriveFolder("https://github.com/foo/bar.git"), "bar")
        XCTAssertEqual(CloneRules.deriveFolder("git@github.com:foo/bar.git"), "bar")
        XCTAssertEqual(CloneRules.deriveFolder("https://github.com/foo/bar/"), "bar")
        XCTAssertEqual(CloneRules.deriveFolder("https://github.com/foo/bar.git//"), "bar")
        XCTAssertEqual(CloneRules.deriveFolder("git@host:bar.git"), "bar")
        XCTAssertEqual(CloneRules.deriveFolder("  "), "")
    }

    func testUrlSoftValidation() {
        for ok in ["https://github.com/foo/bar.git", "ssh://git@host/foo/bar", "git@github.com:foo/bar.git", "git://h/x.git"] {
            XCTAssertNil(CloneRules.urlIssue(ok), ok)
        }
        for bad in ["", "  ", "bar", "ftp://h/x", "https://host", "https:///x", "-oProxy=x", "https://h/a b", "file:///etc/passwd"] {
            XCTAssertNotNil(CloneRules.urlIssue(bad), bad)
        }
    }

    func testFolderAndParentValidation() {
        XCTAssertNil(CloneRules.folderIssue(""))
        XCTAssertNil(CloneRules.folderIssue("bar"))
        XCTAssertNotNil(CloneRules.folderIssue("a/b"))
        XCTAssertNotNil(CloneRules.folderIssue(".."))
        XCTAssertNil(CloneRules.parentIssue("/Users/me/code"))
        XCTAssertNotNil(CloneRules.parentIssue("code"))
        XCTAssertNotNil(CloneRules.parentIssue(" "))
        XCTAssertEqual(CloneRules.defaultParent(["/Users/me/code/app", "/x/y"]), "/Users/me/code")
        XCTAssertEqual(CloneRules.defaultParent([]), "")
    }

    func testCloneDraftFollowsUrlUntilFolderEdited() {
        var c = CloneDraft(parentDir: "/p")
        c.setURL("https://h/o/one.git")
        XCTAssertEqual(c.folder, "one")
        c.setFolder("mine")
        c.setURL("https://h/o/two.git")
        XCTAssertEqual(c.folder, "mine")
        c.setFolder("")
        c.setURL("https://h/o/three.git")
        XCTAssertEqual(c.folder, "three")
        XCTAssertTrue(c.isValid)
    }

    func testCloneArgsOmitEmptyFolder() {
        var c = CloneDraft(parentDir: " /p ")
        c.setURL(" https://h/o/x.git ")
        XCTAssertEqual(c.cloneArgs()["url"] as? String, "https://h/o/x.git")
        XCTAssertEqual(c.cloneArgs()["parentDir"] as? String, "/p")
        XCTAssertEqual(c.cloneArgs()["folder"] as? String, "x")
        c.setFolder(""); c.setURL("")
        XCTAssertNil(c.cloneArgs()["folder"])
    }

    // MARK: create gate

    func testCreateEnabledPerMode() {
        let empty = AdoptSelection(), clone = CloneDraft()
        // existing: repo required; fan-out needs a prompt
        XCTAssertFalse(NewTaskRules.canCreate(mode: .existing, spawn: SpawnDraft(), clone: clone, adopt: empty))
        XCTAssertTrue(NewTaskRules.canCreate(mode: .existing, spawn: draft(), clone: clone, adopt: empty))
        XCTAssertFalse(NewTaskRules.canCreate(mode: .existing, spawn: draft { $0.count = 2 }, clone: clone, adopt: empty))
        XCTAssertTrue(NewTaskRules.canCreate(mode: .existing, spawn: draft { $0.count = 2; $0.prompt = "p" }, clone: clone, adopt: empty))
        XCTAssertFalse(NewTaskRules.canCreate(mode: .existing, spawn: draft { $0.agents = ["a": 1] }, clone: clone, adopt: empty))
        XCTAssertFalse(NewTaskRules.canCreate(mode: .existing, spawn: draft { $0.agents = ["a": 11]; $0.prompt = "p" }, clone: clone, adopt: empty))
        // open project: just a repo
        XCTAssertTrue(NewTaskRules.canCreate(mode: .openProject, spawn: draft(), clone: clone, adopt: empty))
        XCTAssertFalse(NewTaskRules.canCreate(mode: .openProject, spawn: SpawnDraft(), clone: clone, adopt: empty))
        // clone: valid url + parent
        var c = CloneDraft(parentDir: "/p")
        XCTAssertFalse(NewTaskRules.canCreate(mode: .clone, spawn: draft(), clone: c, adopt: empty))
        c.setURL("https://h/o/x.git")
        XCTAssertTrue(NewTaskRules.canCreate(mode: .clone, spawn: draft(), clone: c, adopt: empty))
        // adopt: needs a selection; busy blocks everything
        var sel = AdoptSelection(); sel.toggle("/w/a")
        XCTAssertFalse(NewTaskRules.canCreate(mode: .adopt, spawn: draft(), clone: clone, adopt: empty))
        XCTAssertTrue(NewTaskRules.canCreate(mode: .adopt, spawn: draft(), clone: clone, adopt: sel))
        XCTAssertFalse(NewTaskRules.canCreate(mode: .adopt, spawn: draft(), clone: clone, adopt: sel, busy: true))
    }

    // MARK: branches

    func testBranchOrderAndDefaultBase() {
        XCTAssertEqual(NewTaskRules.orderedBranches(["a", "main", "z"], current: "main"), ["main", "a", "z"])
        XCTAssertEqual(NewTaskRules.orderedBranches(["a"], current: "gone"), ["a"])
        XCTAssertEqual(NewTaskRules.defaultBase(branches: ["main", "a"], current: "main", keeping: ""), "main")
        XCTAssertEqual(NewTaskRules.defaultBase(branches: ["main", "a"], current: "main", keeping: "a"), "a")
        XCTAssertEqual(NewTaskRules.defaultBase(branches: ["main", "a"], current: "main", keeping: "stale"), "main")
        XCTAssertEqual(NewTaskRules.defaultBase(branches: [], current: nil, keeping: "x"), "")
    }

    // MARK: adopt

    func testAdoptSelectionStateAndOrder() {
        let paths = ["/w/a", "/w/b", "/w/c"]
        var s = AdoptSelection()
        s.toggle("/w/c"); s.toggle("/w/a")
        XCTAssertEqual(s.ordered(paths), ["/w/a", "/w/c"])
        s.toggle("/w/a")
        XCTAssertEqual(s.count, 1)
        s.selectAll(paths); XCTAssertEqual(s.count, 3)
        s.keep(only: ["/w/b"]); XCTAssertEqual(s.ordered(paths), ["/w/b"])
        s.clear(); XCTAssertEqual(s.count, 0)
    }

    func testAdoptProgressTailAndOutcome() {
        XCTAssertEqual(AdoptSelection.progress(done: 2, total: 3), "2/3")
        XCTAssertEqual(AdoptSelection.pathTail("/Users/me/wt/feat-x"), "…/wt/feat-x")
        XCTAssertEqual(AdoptSelection.pathTail("/a/b"), "/a/b")
        XCTAssertEqual(AdoptSelection.next(adopted: ["t1"], failures: []), .open("t1"))
        XCTAssertEqual(AdoptSelection.next(adopted: ["t1", "t2"], failures: []), .dismiss)
        XCTAssertEqual(AdoptSelection.next(adopted: ["t1"], failures: ["x"]), .stay)
        XCTAssertEqual(AdoptSelection.next(adopted: [], failures: ["x"]), .stay)
    }
}
