/**
 * Force-removing a worktree must leave the destroyed work recoverable.
 *
 * `remove(path, { force: true })` runs `git worktree remove --force`, which
 * deletes uncommitted edits AND untracked files with no copy anywhere. Three
 * callers reach it without a fresh dirty check (a queued task deletion whose
 * `force` was frozen a daemon restart earlier, the scratch-shell teardown, and
 * the worktrees page's force retry on a stale row), so the salvage guard lives
 * at the shared chokepoint rather than in each of them.
 *
 * Real git, real files, real destruction: the assertions read the recovered
 * content back out of the object database AFTER the directory is gone, because
 * a snapshot nobody can restore from is the failure this exists to prevent.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let tmpRoot: string
let repo: string

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-salvage-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  git(repo, "init", "-q", ".")
  git(repo, "config", "user.email", "test@example.com")
  git(repo, "config", "user.name", "Test")
  fs.writeFileSync(path.join(repo, "tracked.txt"), "committed\n")
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "init")
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

/** A worktree holding one modified tracked file and one never-added file. */
function dirtyWorktree(branch: string): string {
  const wt = path.join(tmpRoot, branch)
  git(repo, "worktree", "add", "-q", wt, "-b", branch)
  fs.appendFileSync(path.join(wt, "tracked.txt"), "uncommitted edit\n")
  fs.writeFileSync(path.join(wt, "never-added.txt"), "brand new file\n")
  return wt
}

test("a force-removed worktree's uncommitted work is recoverable from the salvage ref", async () => {
  const wt = dirtyWorktree("feature")
  let salvaged: { ref: string; commit: string } | null = null

  await new GitWorktreeManager().remove(wt, {
    force: true,
    onSalvage: (record) => {
      salvaged = record
    },
  })

  expect(fs.existsSync(wt)).toBe(false)
  const record = salvaged as { ref: string; commit: string } | null
  expect(record).not.toBeNull()
  expect(record?.ref).toMatch(/^refs\/rove\/salvage\/feature-\d{8}T\d{6}Z$/)

  // The recovery a user actually performs, against the destroyed worktree.
  expect(git(repo, "show", `${record?.ref}:never-added.txt`)).toBe("brand new file\n")
  expect(git(repo, "show", `${record?.ref}:tracked.txt`)).toBe("committed\nuncommitted edit\n")

  // Reachable by ref, so `gc` can't reap it and `for-each-ref` finds it.
  expect(git(repo, "for-each-ref", "refs/rove/salvage", "--format=%(refname)")).toContain(record?.ref)
})

test("ignored files stay out of the snapshot", async () => {
  const wt = dirtyWorktree("ignored")
  fs.mkdirSync(path.join(wt, "node_modules"))
  fs.writeFileSync(path.join(wt, "node_modules", "big.bin"), "vendor junk\n")

  let salvaged: { ref: string; commit: string } | null = null
  await new GitWorktreeManager().remove(wt, {
    force: true,
    onSalvage: (record) => {
      salvaged = record
    },
  })

  const ref = (salvaged as { ref: string } | null)?.ref
  expect(git(repo, "ls-tree", "-r", "--name-only", String(ref))).not.toContain("node_modules")
})

test("a clean worktree salvages nothing", async () => {
  const wt = path.join(tmpRoot, "clean")
  git(repo, "worktree", "add", "-q", wt, "-b", "clean")

  let called = false
  let salvaged: { ref: string } | null = null
  await new GitWorktreeManager().remove(wt, {
    force: true,
    onSalvage: (r) => {
      called = true
      salvaged = r
    },
  })

  expect(called).toBe(true)
  expect(salvaged).toBeNull()
  expect(git(repo, "for-each-ref", "refs/rove/salvage", "--format=%(refname)").trim()).toBe("")
})

test("an unforced removal of a clean worktree takes no snapshot", async () => {
  const wt = path.join(tmpRoot, "quiet")
  git(repo, "worktree", "add", "-q", wt, "-b", "quiet")

  let called = false
  await new GitWorktreeManager().remove(wt, {
    onSalvage: () => {
      called = true
    },
  })

  expect(called).toBe(false)
})
