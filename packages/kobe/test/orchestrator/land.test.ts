/**
 * `landTask` integration tests — real git in a tmp repo (no mocks), same
 * rationale as `worktree.test.ts`: the whole job is git's merge/squash/conflict
 * surface, so mocking it would just test the mock.
 *
 * Covers the three branches that matter: a clean merge lands and reports the
 * base branch + commit; squash collapses to one commit; a conflict aborts (base
 * checkout left clean) and throws `LandConflictError` with the file list.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  EMPTY_BRANCH_CODE,
  EMPTY_BRANCH_DIRTY_WORKTREE_CODE,
  EmptyBranchDirtyWorktreeError,
  EmptyBranchError,
  LandConflictError,
  MISSING_REF_CODE,
  MainCheckoutDirtyError,
  MissingRefError,
} from "../../src/orchestrator/errors.ts"
import { landTask, landTaskWithCleanup } from "../../src/orchestrator/land.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"
import { toTaskId } from "../../src/types/task.ts"

let tmpRoot: string
let repo: string

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`)
}

function write(rel: string, body: string): void {
  fs.writeFileSync(path.join(repo, rel), body)
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-land-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  git(["init", "-b", "main"], repo)
  git(["config", "user.email", "t@t.t"], repo)
  git(["config", "user.name", "t"], repo)
  write("a.txt", "base\n")
  git(["add", "."], repo)
  git(["commit", "-m", "base"], repo)
})

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // ignored
  }
})

/** A minimal task whose branch is `branch`, rooted at the local repo. */
function task(branch: string): Task {
  const now = new Date().toISOString()
  return {
    id: toTaskId("t-land"),
    title: "t",
    repo,
    branch,
    worktreePath: "",
    status: "backlog",
    kind: "task",
    createdAt: now,
    updatedAt: now,
  }
}

describe("landTask", () => {
  test("clean merge lands the branch and reports base + commit", async () => {
    git(["checkout", "-b", "feat"], repo)
    write("b.txt", "feature\n")
    git(["add", "."], repo)
    git(["commit", "-m", "feat commit"], repo)
    git(["checkout", "main"], repo)

    const res = await landTask(task("feat"))
    expect(res.landedOn).toBe("main")
    expect(res.strategy).toBe("merge")
    expect(res.commit).toMatch(/^[0-9a-f]+$/)
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true)
  })

  test("squash lands as a single commit", async () => {
    git(["checkout", "-b", "feat"], repo)
    write("b.txt", "feature\n")
    git(["add", "."], repo)
    git(["commit", "-m", "feat commit"], repo)
    git(["checkout", "main"], repo)

    const res = await landTask(task("feat"), { strategy: "squash" })
    expect(res.strategy).toBe("squash")
    // A squash merge is a normal (single-parent) commit — not a merge commit.
    const parents = spawnSync("git", ["rev-list", "--parents", "-1", "HEAD"], { cwd: repo, encoding: "utf8" })
      .stdout.trim()
      .split(/\s+/)
    expect(parents.length).toBe(2) // <commit> <one-parent>
  })

  test("conflict aborts, leaves base clean, throws with the file list", async () => {
    git(["checkout", "-b", "feat"], repo)
    write("a.txt", "feature edit\n")
    git(["commit", "-am", "feat edit"], repo)
    git(["checkout", "main"], repo)
    write("a.txt", "main edit\n")
    git(["commit", "-am", "main edit"], repo)

    await expect(landTask(task("feat"))).rejects.toBeInstanceOf(LandConflictError)
    // Base checkout must be clean after the abort (no half-merge left behind).
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout.trim()
    expect(status).toBe("")
  })

  test("merge refuses a branch with no commits ahead (already merged / empty)", async () => {
    // `feat` branches off main but adds no commits of its own. Landing it
    // would be a git-level no-op — landTask must reject it as EMPTY_BRANCH
    // rather than report a fake success on the unchanged base commit.
    git(["branch", "feat"], repo)
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()

    await expect(landTask(task("feat"))).rejects.toBeInstanceOf(EmptyBranchError)
    await expect(landTask(task("feat"))).rejects.toThrow(EMPTY_BRANCH_CODE)
    // Base checkout must be untouched — no phantom merge commit.
    const after = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()
    expect(after).toBe(head)
  })

  test("empty branch + clean worktree → EMPTY_BRANCH (no-op, worker delivered nothing)", async () => {
    // A materialised worktree on `feat` with no commits and no local changes:
    // the worker may have reported success without delivering anything.
    const wt = path.join(tmpRoot, "wt-clean")
    git(["worktree", "add", "-b", "feat", wt], repo)
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()

    await expect(landTask({ ...task("feat"), worktreePath: wt })).rejects.toBeInstanceOf(EmptyBranchError)
    await expect(landTask({ ...task("feat"), worktreePath: wt })).rejects.toThrow(/no-op/)
    const after = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()
    expect(after).toBe(head)
  })

  test("empty branch + dirty worktree → EMPTY_BRANCH_DIRTY_WORKTREE listing the uncommitted files", async () => {
    // The work was WRITTEN but never committed: branch has 0 commits ahead,
    // the worktree still holds the changes. Refuse, name the files, and hint
    // at committing in the worktree — never silently drop them into a no-op.
    const wt = path.join(tmpRoot, "wt-dirty")
    git(["worktree", "add", "-b", "feat", wt], repo)
    fs.writeFileSync(path.join(wt, "wip.txt"), "uncommitted work\n")

    try {
      await landTask({ ...task("feat"), worktreePath: wt })
      expect.unreachable("landTask should refuse an empty branch with a dirty worktree")
    } catch (err) {
      expect(err).toBeInstanceOf(EmptyBranchDirtyWorktreeError)
      const msg = (err as Error).message
      expect(msg).toContain(EMPTY_BRANCH_DIRTY_WORKTREE_CODE)
      expect(msg).toContain("wip.txt")
      expect(msg).toContain(wt)
      expect(msg).toMatch(/commit them in the worktree/)
    }
    // The uncommitted file survives the refusal, and the base is untouched.
    expect(fs.existsSync(path.join(wt, "wip.txt"))).toBe(true)
    expect(fs.existsSync(path.join(repo, "wip.txt"))).toBe(false)
  })

  test("a branch that no longer resolves is MISSING_REF, not a phantom conflict", async () => {
    // The recorded branch was renamed outside Rove, so `git rev-list --count
    // main..feat` exits 128 with empty stdout. Before the exitCode guard the
    // unparseable count read as "has work", the merge then failed with "not
    // something we can merge", and land reported LAND_CONFLICT with an empty
    // conflicted-file list — sending the operator hunting for files to resolve.
    git(["checkout", "-b", "feat"], repo)
    write("b.txt", "feature\n")
    git(["add", "."], repo)
    git(["commit", "-m", "feat commit"], repo)
    git(["checkout", "main"], repo)
    git(["branch", "-m", "feat", "feat-renamed"], repo)
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()

    await expect(landTask(task("feat"))).rejects.toBeInstanceOf(MissingRefError)
    await expect(landTask(task("feat"))).rejects.toThrow(MISSING_REF_CODE)
    await expect(landTask(task("feat"))).rejects.toThrow(/'feat' does not resolve/)
    // No merge was attempted: base checkout clean, HEAD unmoved.
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout.trim()
    expect(status).toBe("")
    expect(spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()).toBe(head)
  })

  test("refuses a dirty base checkout", async () => {
    git(["checkout", "-b", "feat"], repo)
    write("b.txt", "feature\n")
    git(["add", "."], repo)
    git(["commit", "-m", "feat commit"], repo)
    git(["checkout", "main"], repo)
    write("dirty.txt", "uncommitted\n") // untracked → dirty

    await expect(landTask(task("feat"))).rejects.toBeInstanceOf(MainCheckoutDirtyError)
  })
})

describe("landTaskWithCleanup worktree cleanup", () => {
  let wt: string

  /** Real worktree on branch `feat` with one committed file, base back on main. */
  function makeWorktree(): void {
    wt = path.join(tmpRoot, "wt")
    git(["worktree", "add", "-b", "feat", wt], repo)
    fs.writeFileSync(path.join(wt, "b.txt"), "feature\n")
    git(["add", "."], wt)
    git(["commit", "-m", "feat commit"], wt)
  }

  function deps() {
    const cleared: string[] = []
    return {
      cleared,
      deps: {
        worktrees: new GitWorktreeManager(),
        clearWorktreePath: async (id: unknown) => {
          cleared.push(String(id))
        },
      },
    }
  }

  function branchExists(name: string): boolean {
    return spawnSync("git", ["branch", "--list", name], { cwd: repo, encoding: "utf8" }).stdout.trim().length > 0
  }

  test("successful land removes the worktree, keeps the branch, unlinks the task", async () => {
    makeWorktree()
    const { deps: d, cleared } = deps()
    const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: wt }, { removeWorktree: true }, d)
    expect(res.worktree).toEqual({ removed: true })
    expect(fs.existsSync(wt)).toBe(false)
    expect(branchExists("feat")).toBe(true)
    expect(cleared).toEqual(["t-land"])
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true) // the merge itself landed
  })

  test("land with no opts removes the worktree by default, keeping the branch", async () => {
    // The DEFAULT, not the flag: `{}` is what the TUI and a flagless
    // `rove api land` send. Revert land.ts to `opts.removeWorktree ? … :
    // undefined` and this goes red on its first two assertions.
    makeWorktree()
    const { deps: d, cleared } = deps()
    const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: wt }, {}, d)
    expect(res.worktree).toEqual({ removed: true })
    expect(fs.existsSync(wt)).toBe(false)
    expect(branchExists("feat")).toBe(true)
    expect(cleared).toEqual(["t-land"])
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true)
  })

  test("removeWorktree: false keeps the worktree and reports no cleanup", async () => {
    makeWorktree()
    const { deps: d, cleared } = deps()
    const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: wt }, { removeWorktree: false }, d)
    expect(res.worktree).toBeUndefined()
    expect(fs.existsSync(wt)).toBe(true)
    expect(branchExists("feat")).toBe(true)
    expect(cleared).toEqual([])
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true) // the merge still landed
  })

  test("a half-removed worktree still counts as landed, and names the leftover directory", async () => {
    // git deregisters the worktree, then fails to unlink it (an unwritable
    // directory inside). Reporting `removed: false` here would send the user
    // to retry a removal git cannot act on at all.
    makeWorktree()
    // Committed, not untracked: an untracked file would trip the dirty
    // refusal, which is a different (already-covered) branch. The tree is
    // clean — it is only the FILESYSTEM that will not give the directory up.
    const locked = path.join(wt, "fixture")
    fs.mkdirSync(locked)
    fs.writeFileSync(path.join(locked, "keep.txt"), "x")
    git(["add", "."], wt)
    git(["commit", "-m", "fixture"], wt)
    fs.chmodSync(locked, 0o555)
    try {
      const { deps: d, cleared } = deps()
      const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: wt }, {}, d)

      // The merge landed and the bookkeeping ran — the only thing that did not
      // happen is the directory delete, and that is what `residue` says.
      expect(res.worktree?.removed).toBe(true)
      expect(res.worktree?.residue?.path).toBe(wt)
      expect(res.worktree?.residue?.reason).toMatch(/Permission denied/)
      expect(cleared).toEqual(["t-land"])
      expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true)
      // Reported, not cleaned up: land never deletes what git could not.
      expect(fs.existsSync(path.join(locked, "keep.txt"))).toBe(true)
    } finally {
      fs.chmodSync(locked, 0o755)
    }
  })

  test("a dirty worktree is refused on the default path, and the land still stands", async () => {
    makeWorktree()
    fs.writeFileSync(path.join(wt, "wip.txt"), "uncommitted\n")
    const { deps: d, cleared } = deps()
    const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: wt }, {}, d)
    expect(res.worktree?.removed).toBe(false)
    expect(res.worktree?.reason).toMatch(/dirty/)
    expect(fs.existsSync(path.join(wt, "wip.txt"))).toBe(true)
    expect(cleared).toEqual([])
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true)
  })

  test("caller inside the worktree is refused on the default path too", async () => {
    makeWorktree()
    const { deps: d } = deps()
    const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: wt }, { callerCwd: wt }, d)
    expect(res.worktree?.removed).toBe(false)
    expect(res.worktree?.reason).toMatch(/caller's own worktree/)
    expect(fs.existsSync(wt)).toBe(true)
  })

  test("a failed worktreePath clear still reports the worktree as removed", async () => {
    makeWorktree()
    const res = await landTaskWithCleanup(
      { ...task("feat"), worktreePath: wt },
      {},
      {
        worktrees: new GitWorktreeManager(),
        clearWorktreePath: async () => {
          throw new Error("tasks.json write failed")
        },
      },
    )
    expect(res.worktree?.removed).toBe(true)
    expect(res.worktree?.reason).toMatch(/tasks\.json write failed/)
    expect(fs.existsSync(wt)).toBe(false)
  })

  /**
   * Same ordering bug as the worktrees page, reached through land: the dirty
   * check that let this land through ran seconds earlier in `landTask`, and
   * an engine still running has kept writing since then. Removing its directory
   * first means every write after that goes to an unlinked inode.
   *
   * The assertion is the ORDER — recorded at the moment teardown runs, when
   * the directory must still exist. "teardown was called" alone would pass
   * with the calls reversed, which is the bug.
   */
  test("tears the engine session down before removing the landed worktree", async () => {
    makeWorktree()
    const order: string[] = []
    const res = await landTaskWithCleanup(
      { ...task("feat"), worktreePath: wt },
      {},
      {
        worktrees: new GitWorktreeManager(),
        clearWorktreePath: async () => {
          order.push("clearWorktreePath")
        },
        tearDownSession: async (id) => {
          order.push(`teardown:${String(id)}:dirExists=${fs.existsSync(wt)}`)
        },
      },
    )
    expect(res.worktree).toEqual({ removed: true })
    expect(order).toEqual(["teardown:t-land:dirExists=true", "clearWorktreePath"])
    expect(fs.existsSync(wt)).toBe(false)
  })

  test("a refused removal does not tear down the session", async () => {
    // No directory is going anywhere, so killing a live engine would be pure
    // collateral damage — the caller keeps working in that worktree.
    makeWorktree()
    fs.writeFileSync(path.join(wt, "wip.txt"), "uncommitted\n")
    const torn: string[] = []
    const res = await landTaskWithCleanup(
      { ...task("feat"), worktreePath: wt },
      { callerCwd: wt },
      {
        worktrees: new GitWorktreeManager(),
        clearWorktreePath: async () => {},
        tearDownSession: async (id) => {
          torn.push(String(id))
        },
      },
    )
    expect(res.worktree?.removed).toBe(false)
    expect(torn).toEqual([])
    expect(fs.existsSync(path.join(wt, "wip.txt"))).toBe(true)
  })

  test("a failing teardown does not strand the landed worktree", async () => {
    // The merge has already committed; a dead or unreachable session must not
    // leave the directory behind forever. `remove()`'s own dirty refusal is
    // the real guard on unsaved work.
    makeWorktree()
    const res = await landTaskWithCleanup(
      { ...task("feat"), worktreePath: wt },
      {},
      {
        worktrees: new GitWorktreeManager(),
        clearWorktreePath: async () => {},
        tearDownSession: async () => {
          throw new Error("session host unreachable")
        },
      },
    )
    expect(res.worktree).toEqual({ removed: true })
    expect(fs.existsSync(wt)).toBe(false)
  })

  /**
   * The gate: `git branch -D` cannot delete a branch a live worktree has
   * checked out, and `deleteBranch` is best-effort (exit code discarded), so
   * without the gate `--delete-branch` ran, git refused, and land reported a
   * clean success — anchor included — for a branch that is still right there.
   *
   * Mutation: drop `&& !worktreeGone` from the gate in `land.ts` and this goes
   * red on `branchKept` (the delete runs and reports nothing).
   */
  test("keeps the branch when the worktree it is checked out in stays", async () => {
    makeWorktree()
    const { deps: d } = deps()
    const res = await landTaskWithCleanup(
      { ...task("feat"), worktreePath: wt },
      { removeWorktree: false, deleteBranch: true, strategy: "squash" },
      d,
    )
    // git keeps the branch either way; the point is that the RESULT says so.
    expect(branchExists("feat")).toBe(true)
    expect(res.branchKept?.reason).toMatch(/still has the branch checked out/)
    // No anchor: writing one before the delete is attempted would name a
    // salvage ref for a branch nothing deleted.
    expect(res.branchAnchor).toBeUndefined()
  })

  test("a refused removal keeps the branch too, and reports the refusal as the reason", async () => {
    makeWorktree()
    fs.writeFileSync(path.join(wt, "wip.txt"), "uncommitted\n")
    const { deps: d } = deps()
    const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: wt }, { deleteBranch: true }, d)
    expect(res.worktree?.removed).toBe(false)
    expect(branchExists("feat")).toBe(true)
    expect(res.branchKept?.reason).toMatch(/dirty/)
  })

  test("the worktree going lets --delete-branch through", async () => {
    makeWorktree()
    const { deps: d } = deps()
    const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: wt }, { deleteBranch: true }, d)
    expect(res.worktree?.removed).toBe(true)
    expect(branchExists("feat")).toBe(false)
    expect(res.branchKept).toBeUndefined()
  })

  test("a task that never materialised a worktree still deletes its branch", async () => {
    // Nothing holds the branch, so the gate must not block it.
    git(["branch", "feat"], repo)
    git(["checkout", "feat"], repo)
    write("b.txt", "feature\n")
    git(["add", "."], repo)
    git(["commit", "-m", "feat commit"], repo)
    git(["checkout", "main"], repo)
    const { deps: d } = deps()
    const res = await landTaskWithCleanup(task("feat"), { deleteBranch: true }, d)
    expect(branchExists("feat")).toBe(false)
    expect(res.branchKept).toBeUndefined()
  })

  test("never removes the base checkout even if worktreePath points at it", async () => {
    makeWorktree()
    const { deps: d } = deps()
    const res = await landTaskWithCleanup({ ...task("feat"), worktreePath: repo }, { removeWorktree: true }, d)
    expect(res.worktree?.removed).toBe(false)
    expect(res.worktree?.reason).toMatch(/base checkout/)
    expect(fs.existsSync(repo)).toBe(true)
  })
})
