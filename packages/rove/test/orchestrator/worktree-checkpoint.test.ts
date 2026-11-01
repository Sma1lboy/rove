/**
 * Checkpoints are file-only undo points kept as `refs/rove/checkpoints/<task>/<n>`.
 *
 * Real git, real files: every assertion reads the working tree or the object
 * database back, because a snapshot nobody can restore from is the failure
 * this exists to prevent.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { LocalExecHost } from "../../src/exec/exec-host.ts"
import {
  CHECKPOINT_RETENTION,
  type CheckpointDeps,
  deleteTaskCheckpoints,
  listCheckpoints,
  pruneCheckpoints,
  takeCheckpoint,
} from "../../src/orchestrator/worktree/checkpoint.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let tmpRoot: string
let repo: string
let wt: string
const TASK = "task-abc123"

// Every test spawns real git many times; the 5s default trips when the suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 })

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout
}

function put(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true })
  fs.writeFileSync(path.join(wt, rel), content)
}

const read = (rel: string): string => fs.readFileSync(path.join(wt, rel), "utf8")
const has = (rel: string): boolean => fs.existsSync(path.join(wt, rel))
const mgr = (): GitWorktreeManager => new GitWorktreeManager()

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-ckpt-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  git(repo, "init", "-q", ".")
  git(repo, "config", "user.email", "test@example.com")
  git(repo, "config", "user.name", "Test")
  fs.writeFileSync(path.join(repo, "a.txt"), "a0\n")
  fs.writeFileSync(path.join(repo, "b.txt"), "b0\n")
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n*.log\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "init")
  wt = path.join(tmpRoot, "wt")
  git(repo, "worktree", "add", "-q", wt, "-b", "feature")
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

/** Contents of `file` inside checkpoint `n`, straight from the object database. */
const inCheckpoint = (n: number, file: string): string =>
  git(repo, "show", `refs/rove/checkpoints/${TASK}/${n}:${file}`)
const filesIn = (n: number): string[] =>
  git(repo, "ls-tree", "-r", "--name-only", `refs/rove/checkpoints/${TASK}/${n}`).split("\n").filter(Boolean)

test("a checkpoint holds modified, added, deleted and untracked files, never ignored ones, and moves nothing", async () => {
  put("a.txt", "a1\n") // modified
  fs.rmSync(path.join(wt, "b.txt")) // deleted
  put("staged-new.txt", "s\n") // added to the index
  git(wt, "add", "staged-new.txt")
  put("src/untracked.txt", "u\n") // never added
  put("node_modules/dep/index.js", "x\n") // ignored dir
  put("debug.log", "x\n") // ignored by pattern
  const headBefore = git(wt, "rev-parse", "HEAD")
  const statusBefore = git(wt, "status", "--porcelain")

  const res = await mgr().takeCheckpoint(wt, TASK, { tabId: "tab-2" })

  expect(res.created && res.checkpoint.n).toBe(1)
  expect(inCheckpoint(1, "a.txt")).toBe("a1\n")
  expect(inCheckpoint(1, "staged-new.txt")).toBe("s\n")
  expect(inCheckpoint(1, "src/untracked.txt")).toBe("u\n")
  expect(filesIn(1)).toEqual([".gitignore", "a.txt", "src/untracked.txt", "staged-new.txt"].sort())
  // Parent is the branch tip, so `git show` diffs against real history.
  expect(git(repo, "rev-parse", `refs/rove/checkpoints/${TASK}/1^`).trim()).toBe(headBefore.trim())
  expect(git(repo, "log", "-1", "--format=%s", `refs/rove/checkpoints/${TASK}/1`).trim()).toMatch(
    /^rove checkpoint 1 tab-2 \d{4}-\d\d-\d\dT[\d:.]+Z$/,
  )
  // Branch, HEAD and the real index (staged-new.txt still staged) are untouched.
  expect(git(wt, "rev-parse", "HEAD")).toBe(headBefore)
  expect(git(wt, "status", "--porcelain")).toBe(statusBefore)
  expect((await mgr().listCheckpoints(wt, TASK)).map((c) => [c.n, c.tabId])).toEqual([[1, "tab-2"]])
})

test("an unchanged tree is skipped, and any change takes the next number", async () => {
  const first = await mgr().takeCheckpoint(wt, TASK)
  const again = await mgr().takeCheckpoint(wt, TASK)
  expect(first.created).toBe(true)
  expect(again.created).toBe(false)
  expect(again.checkpoint.n).toBe(1)

  put("a.txt", "a1\n")
  const next = await mgr().takeCheckpoint(wt, TASK)
  expect(next.created && next.checkpoint.n).toBe(2)

  // Back to the n=1 content: compared against the LATEST (2), so it is new, not a skip.
  put("a.txt", "a0\n")
  const third = await mgr().takeCheckpoint(wt, TASK)
  expect(third.created && third.checkpoint.n).toBe(3)
})

test("rewind makes the tree equal the target — deleting later files, restoring deleted ones — without moving HEAD", async () => {
  put("a.txt", "a1\n")
  put("keep/nested/deep.txt", "d1\n")
  await mgr().takeCheckpoint(wt, TASK) // 1

  put("a.txt", "a2\n")
  fs.rmSync(path.join(wt, "b.txt"))
  fs.rmSync(path.join(wt, "keep"), { recursive: true })
  put("created-later.txt", "later\n")
  put("newdir/also.txt", "later\n")
  put("node_modules/dep/index.js", "ignored work\n") // not ours to touch
  await mgr().takeCheckpoint(wt, TASK) // 2
  const headBefore = git(wt, "rev-parse", "HEAD")
  const branchBefore = git(wt, "rev-parse", "--abbrev-ref", "HEAD")

  const res = await mgr().rewindToCheckpoint(wt, TASK, 1)

  expect(read("a.txt")).toBe("a1\n")
  expect(read("b.txt")).toBe("b0\n") // deleted after #1, back
  expect(read("keep/nested/deep.txt")).toBe("d1\n")
  expect(has("created-later.txt")).toBe(false)
  expect(has("newdir")).toBe(false)
  expect(read("node_modules/dep/index.js")).toBe("ignored work\n")
  expect(git(wt, "rev-parse", "HEAD")).toBe(headBefore)
  expect(git(wt, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branchBefore)
  // Index is back at HEAD: the rewind left no staged residue.
  expect(git(wt, "diff", "--cached", "--name-only")).toBe("")
  // State equals checkpoint 1 exactly (the snapshot tree is the proof).
  expect((await mgr().takeCheckpoint(wt, TASK)).checkpoint.tree).toBe(res.target.tree)
  // Rewind did not need a new undo point: the tree was already checkpoint 2.
  expect(res.undo.n).toBe(2)
})

test("rewind checkpoints uncheckpointed work first, so a rewind of the rewind restores it", async () => {
  put("a.txt", "a1\n")
  await mgr().takeCheckpoint(wt, TASK) // 1

  put("a.txt", "a-unsaved\n")
  put("scratch.txt", "unsaved\n")
  const rewound = await mgr().rewindToCheckpoint(wt, TASK, 1)
  expect(rewound.undo.n).toBe(2)
  expect(read("a.txt")).toBe("a1\n")
  expect(has("scratch.txt")).toBe(false)

  const back = await mgr().rewindToCheckpoint(wt, TASK, rewound.undo.n)
  expect(read("a.txt")).toBe("a-unsaved\n")
  expect(read("scratch.txt")).toBe("unsaved\n")
  // Only the LATEST checkpoint (2) is skipped as unchanged; tree = #1 is not it, so this is a new one.
  expect(back.undo.n).toBe(3)
  expect(back.undo.tree).toBe(rewound.target.tree)
  expect(read("b.txt")).toBe("b0\n")
})

test("rewinding to a checkpoint that does not exist fails and leaves the tree alone", async () => {
  put("a.txt", "a1\n")
  await expect(mgr().rewindToCheckpoint(wt, TASK, 7)).rejects.toThrow(/^CHECKPOINT_NOT_FOUND:/)
  expect(read("a.txt")).toBe("a1\n")
  expect(await mgr().listCheckpoints(wt, TASK)).toEqual([])
})

test("retention keeps the newest N, numbering continues past the gap, and delete removes every ref", async () => {
  const deps: CheckpointDeps = {
    runGit: async (exec, args, opts) => {
      const r = await exec.run(["git", ...args], { cwd: opts.cwd, env: opts.env })
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
    },
  }
  const exec = new LocalExecHost()
  for (let i = 1; i <= 5; i++) {
    put("a.txt", `a${i}\n`)
    await takeCheckpoint(deps, exec, wt, TASK)
  }
  expect(await pruneCheckpoints(deps, exec, wt, TASK, 3)).toBe(2)
  expect((await listCheckpoints(deps, exec, wt, TASK)).map((c) => c.n)).toEqual([3, 4, 5])

  put("a.txt", "a6\n")
  const next = await takeCheckpoint(deps, exec, wt, TASK)
  expect(next.checkpoint.n).toBe(6) // max+1, not count+1

  // Another task's refs are not ours to delete.
  await takeCheckpoint(deps, exec, wt, "task-other")
  expect(await deleteTaskCheckpoints(deps, exec, repo, TASK)).toBe(4)
  expect(await listCheckpoints(deps, exec, repo, TASK)).toEqual([])
  expect((await listCheckpoints(deps, exec, repo, "task-other")).length).toBe(1)
  expect(CHECKPOINT_RETENTION).toBe(100)
})

test("take prunes automatically once past the retention ceiling", async () => {
  const deps: CheckpointDeps = {
    runGit: async (exec, args, opts) => {
      const r = await exec.run(["git", ...args], { cwd: opts.cwd, env: opts.env })
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
    },
  }
  const exec = new LocalExecHost()
  // Seed refs directly: 100 real snapshots would take a minute of spawns.
  const head = git(wt, "rev-parse", "HEAD").trim()
  for (let n = 1; n <= CHECKPOINT_RETENTION; n++) git(repo, "update-ref", `refs/rove/checkpoints/${TASK}/${n}`, head)
  put("a.txt", "over the ceiling\n")
  const res = await takeCheckpoint(deps, exec, wt, TASK)
  expect(res.checkpoint.n).toBe(CHECKPOINT_RETENTION + 1)
  const kept = (await listCheckpoints(deps, exec, wt, TASK)).map((c) => c.n)
  expect(kept.length).toBe(CHECKPOINT_RETENTION)
  expect(kept[0]).toBe(2)
})

test("a nested repository is reported as uncaptured and survives a rewind", async () => {
  const nested = path.join(wt, "vendor", "lib")
  fs.mkdirSync(nested, { recursive: true })
  git(nested, "init", "-q", ".")
  git(nested, "config", "user.email", "t@example.com")
  git(nested, "config", "user.name", "T")
  fs.writeFileSync(path.join(nested, "work.txt"), "uncommitted inside\n")
  git(nested, "add", "-A")
  git(nested, "commit", "-qm", "inner")
  fs.writeFileSync(path.join(nested, "work.txt"), "uncommitted inside, edited\n")

  const res = await mgr().takeCheckpoint(wt, TASK)
  expect(res.created && res.uncaptured).toEqual(["vendor/lib"])

  put("a.txt", "a1\n")
  await mgr().takeCheckpoint(wt, TASK)
  await mgr().rewindToCheckpoint(wt, TASK, 1)
  expect(read("vendor/lib/work.txt")).toBe("uncommitted inside, edited\n")
  expect(read("a.txt")).toBe("a0\n")
})
