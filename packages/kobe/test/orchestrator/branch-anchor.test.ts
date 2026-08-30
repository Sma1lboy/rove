/**
 * Deleting a branch must not make its commits unreachable.
 *
 * `land --strategy squash --delete-branch` is the sequence that used to lose
 * work: the squash writes ONE new commit onto the base with no link back, the
 * worktree removal takes `.git/worktrees/<slug>/logs/HEAD` (the only reflog
 * that ever recorded this branch's tip, because the base checkout never had
 * the branch checked out), and `git branch -D` then takes the branch ref AND
 * its reflog. The original commits end up reachable from nothing — findable
 * only by `git fsck --lost-found`, and only until gc collects them.
 *
 * Real git and a real land: the assertions run `git rev-list --all` and
 * `for-each-ref --contains` AFTER the branch is gone, because "the object is
 * still in the database" is exactly the state that loses the work. What has to
 * hold is REACHABILITY.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { landTaskWithCleanup } from "../../src/orchestrator/land.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"
import { toTaskId } from "../../src/types/task.ts"

let tmpRoot: string
let repo: string

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`)
  return r.stdout
}

function task(branch: string, worktreePath: string): Task {
  const now = new Date().toISOString()
  return {
    id: toTaskId("t-anchor"),
    kind: "task",
    repo,
    title: "anchor",
    branch,
    worktreePath,
    status: "backlog",
    createdAt: now,
    updatedAt: now,
  }
}

/** Whether `sha` is reachable from ANY ref in the repo. */
function reachable(sha: string): boolean {
  return git(repo, "rev-list", "--all")
    .split("\n")
    .some((l) => l.trim() === sha)
}

function deps() {
  return { worktrees: new GitWorktreeManager(), clearWorktreePath: async () => {} }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-anchor-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  git(repo, "init", "-b", "main", ".")
  git(repo, "config", "user.email", "t@t.t")
  git(repo, "config", "user.name", "t")
  fs.writeFileSync(path.join(repo, "a.txt"), "base\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "base")
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

/** A worktree on `branch` with `count` separate commits, tip returned. */
function worktreeWithCommits(branch: string, count: number): { wt: string; tip: string; shas: string[] } {
  const wt = path.join(tmpRoot, branch)
  git(repo, "worktree", "add", "-q", wt, "-b", branch)
  const shas: string[] = []
  for (let i = 1; i <= count; i++) {
    fs.appendFileSync(path.join(wt, "work.txt"), `work ${i}\n`)
    git(wt, "add", "-A")
    git(wt, "commit", "-qm", `commit ${i}`)
    shas.push(git(wt, "rev-parse", "HEAD").trim())
  }
  return { wt, tip: shas[shas.length - 1] as string, shas }
}

test("squash land with --delete-branch keeps every original commit reachable", async () => {
  const { wt, tip, shas } = worktreeWithCommits("feature", 12)

  const res = await landTaskWithCleanup(
    task("feature", wt),
    { strategy: "squash", deleteBranch: true, removeWorktree: true },
    deps(),
  )

  // The land itself did what it says: one squashed commit, branch gone,
  // worktree gone. This is the destructive sequence, not a softened one.
  expect(res.strategy).toBe("squash")
  expect(fs.existsSync(wt)).toBe(false)
  expect(git(repo, "branch", "--list", "feature").trim()).toBe("")

  // The anchor is reported, not just written — a ref nobody is told about is
  // barely better than a dangling object.
  expect(res.branchAnchor?.ref).toMatch(/^refs\/rove\/salvage\/feature-/)
  expect(res.branchAnchor?.commit).toBe(tip)

  // The point of the whole exercise: `git rev-parse` finding the object is
  // NOT enough (a dangling commit answers that too, right up until gc). All
  // twelve must be reachable from a ref.
  for (const sha of shas) expect(reachable(sha)).toBe(true)
  expect(git(repo, "rev-list", "--count", `${res.branchAnchor?.ref}`).trim()).toBe("13") // 12 + base

  // And the recovery path in the docs actually works.
  git(repo, "branch", "recovered", res.branchAnchor?.ref as string)
  expect(git(repo, "log", "--oneline", "recovered").split("\n").filter(Boolean)).toHaveLength(13)
})

test("merge land with --delete-branch writes no anchor — the merge commit already reaches the tip", async () => {
  const { wt, tip } = worktreeWithCommits("merged", 3)

  const res = await landTaskWithCleanup(
    task("merged", wt),
    { strategy: "merge", deleteBranch: true, removeWorktree: true },
    deps(),
  )

  expect(git(repo, "branch", "--list", "merged").trim()).toBe("")
  // No ref written: `--no-ff` parents the commits under the merge, so an
  // anchor would be permanent clutter for work that was never at risk.
  expect(res.branchAnchor).toBeUndefined()
  expect(git(repo, "for-each-ref", "refs/rove/salvage").trim()).toBe("")
  expect(reachable(tip)).toBe(true)
})

test("a plain deleteBranch on an unlanded branch anchors its tip", async () => {
  // Not a land: the same `-D` reached directly (task delete --delete-branch).
  // Nothing has merged this branch, so every commit on it is at risk.
  const { wt, tip } = worktreeWithCommits("unlanded", 2)
  // Remove the worktree first — git refuses to delete a branch checked out in
  // a live one, which is also why the real caller (task deletion) removes the
  // directory before deleting the branch, taking the per-worktree reflog with
  // it. That ordering is precisely what leaves the tip with nothing to hold it.
  git(repo, "worktree", "remove", "--force", wt)
  let anchored: { ref: string; commit: string } | null = null

  await new GitWorktreeManager().deleteBranch(repo, "unlanded", {
    force: true,
    onAnchor: (record) => {
      anchored = record
    },
  })

  expect(git(repo, "branch", "--list", "unlanded").trim()).toBe("")
  expect(anchored).not.toBeNull()
  expect((anchored as unknown as { commit: string }).commit).toBe(tip)
  expect(reachable(tip)).toBe(true)
})
