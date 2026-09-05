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
import { type ExecHost, LocalExecHost } from "../../src/exec/exec-host.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import { type SalvageRecord, salvageRef, salvageWorktree } from "../../src/orchestrator/worktree/salvage.ts"

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

test("a bulk ignored tree stays out of the snapshot", async () => {
  // The exclusion is by SIZE, not by ignored-ness — `.gitignore` says "don't
  // track this", not "this isn't the user's work", and gitignored notes are
  // now rescued (see `salvage-ignored.test.ts` for both directions). What
  // still has to hold is that a dependency tree cannot bloat the snapshot, so
  // this one is genuinely over the per-entry budget: 70 MB of real bytes, not
  // a sparse file (`du` reports a sparse file's allocated size, which is 0).
  const wt = dirtyWorktree("ignored")
  fs.mkdirSync(path.join(wt, "node_modules"))
  fs.writeFileSync(path.join(wt, "node_modules", "big.bin"), Buffer.alloc(70 * 1024 * 1024))

  let salvaged: { ref: string; commit: string } | null = null
  await new GitWorktreeManager().remove(wt, {
    force: true,
    onSalvage: (record) => {
      salvaged = record
    },
  })

  const ref = (salvaged as { ref: string } | null)?.ref
  expect(git(repo, "ls-tree", "-r", "--name-only", String(ref))).not.toContain("node_modules")
  // The ordinary dirty work is still there — the budget skipped one entry,
  // it did not abandon the snapshot.
  expect(git(repo, "show", `${ref}:never-added.txt`)).toBe("brand new file\n")
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

/**
 * A snapshot that reports success while holding a POINTER instead of the work.
 *
 * `git add -A` stages a submodule (and a nested worktree) as a `160000`
 * gitlink — its commit SHA, never its file contents. The ref was written, the
 * audit line told the user to `git restore --source=<ref>`, and the file was
 * in neither the tree nor the SHA the gitlink names. Silence about that is the
 * failure; the record has to say which paths it could not take.
 */
test("a submodule's uncommitted work is reported as uncaptured, not silently missed", async () => {
  const child = path.join(tmpRoot, "child")
  fs.mkdirSync(child)
  git(child, "init", "-q", ".")
  git(child, "config", "user.email", "test@example.com")
  git(child, "config", "user.name", "Test")
  fs.writeFileSync(path.join(child, "c.txt"), "child\n")
  git(child, "add", "-A")
  git(child, "commit", "-qm", "child init")

  git(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "vendor/child")
  git(repo, "commit", "-qm", "add submodule")

  const wt = path.join(tmpRoot, "sub")
  git(repo, "worktree", "add", "-q", wt, "-b", "sub")
  git(wt, "-c", "protocol.file.allow=always", "submodule", "update", "-q", "--init")
  fs.writeFileSync(path.join(wt, "vendor", "child", "subwork.txt"), "SUBWORK\n")

  let salvaged: { ref: string; uncaptured: readonly string[] } | null = null
  await new GitWorktreeManager().remove(wt, {
    force: true,
    onSalvage: (record) => {
      salvaged = record as typeof salvaged
    },
  })

  const record = salvaged as unknown as { ref: string; uncaptured: readonly string[] } | null
  expect(record?.ref).toBeTruthy()
  // The snapshot genuinely cannot hold it — the point is that it says so.
  expect(git(repo, "ls-tree", "-r", "--name-only", record?.ref as string)).not.toContain("subwork.txt")
  expect(record?.uncaptured).toEqual(["vendor/child"])
})

/**
 * A file the repo TRACKS whose path its own `.gitignore` also covers.
 *
 * That combination is ordinary — a committed `dist/README.md` under `dist/`, a
 * committed `server.log` under `*.log` — and the snapshot silently dropped
 * every uncommitted edit to it. The throwaway index was created EMPTY, so git
 * saw those paths as untracked and `.gitignore` applied; the `add -f` rescue
 * pass could not cover for it either, because its input is
 * `git status --ignored`, which reports a tracked file as ` M` and never `!!`.
 *
 * The assertion is the recovered CONTENT, plus the diff direction: the broken
 * snapshot did not merely omit the files, it recorded them as deletions while
 * reporting a clean salvage.
 */
test("a tracked file that .gitignore also matches keeps its uncommitted edits", async () => {
  fs.mkdirSync(path.join(repo, "dist"))
  fs.writeFileSync(path.join(repo, "dist", "README.md"), "committed\n")
  fs.writeFileSync(path.join(repo, "server.log"), "committed\n")
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\ndist/\n*.log\n")
  git(repo, "add", "-A", "-f")
  git(repo, "commit", "-qm", "track files the ignore rules also match")

  const wt = path.join(tmpRoot, "tracked-ignored")
  git(repo, "worktree", "add", "-q", wt, "-b", "tracked-ignored")
  fs.appendFileSync(path.join(wt, "dist", "README.md"), "uncommitted edit\n")
  fs.appendFileSync(path.join(wt, "server.log"), "uncommitted edit\n")

  let salvaged: { ref: string } | null = null
  await new GitWorktreeManager().remove(wt, {
    force: true,
    onSalvage: (record) => {
      salvaged = record
    },
  })

  expect(fs.existsSync(wt)).toBe(false)
  const ref = (salvaged as unknown as { ref: string } | null)?.ref
  expect(ref).toBeTruthy()
  expect(git(repo, "show", `${ref}:dist/README.md`)).toBe("committed\nuncommitted edit\n")
  expect(git(repo, "show", `${ref}:server.log`)).toBe("committed\nuncommitted edit\n")
  // Recorded as edits, not as the deletions the empty index produced.
  expect(git(repo, "diff", "--stat", `${ref}^`, ref as string)).not.toContain("deletion")
})

/**
 * Two force-removes inside the same second.
 *
 * The ref name carries only a second-resolution stamp and a lossy slug
 * (`feat/login` and `feat-login` flatten together), and `git update-ref`
 * overwrites unconditionally — so deleting a batch of tasks, which lands
 * several removals in one second by construction, left the first snapshot as a
 * dangling commit reachable from nothing. Both callers were handed a ref and
 * told their work was saved.
 *
 * The clock is pinned because the bug is invisible whenever the two calls
 * happen to straddle a second boundary.
 */
test("two salvages in the same second both stay recoverable", async () => {
  const exec = new LocalExecHost()
  const deps = {
    runGit: async (e: ExecHost, args: readonly string[], opts: { cwd: string; env?: Record<string, string> }) => {
      const r = await e.run(["git", ...args], opts)
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
    },
  }
  const now = new Date("2026-01-02T03:04:05Z")

  const refs: string[] = []
  for (const [branch, content] of [
    ["feat/login", "WORK-A"],
    ["feat-login", "WORK-B"],
  ] as const) {
    const wt = path.join(tmpRoot, branch.replace("/", "_"))
    git(repo, "worktree", "add", "-q", wt, "-b", branch)
    fs.writeFileSync(path.join(wt, "only.txt"), `${content}\n`)
    const record = await salvageWorktree(deps, exec, wt, now)
    expect(record).not.toBeNull()
    refs.push((record as SalvageRecord).ref)
  }

  // Distinct names, and BOTH still resolve — the second write must not have
  // been allowed to take the first one's name.
  expect(new Set(refs).size).toBe(2)
  expect(git(repo, "show", `${refs[0]}:only.txt`)).toBe("WORK-A\n")
  expect(git(repo, "show", `${refs[1]}:only.txt`)).toBe("WORK-B\n")
  expect(git(repo, "for-each-ref", "refs/rove/salvage", "--format=%(refname)").trim().split("\n")).toHaveLength(2)
})

/** A branch with no ASCII in it must still be identifiable in the ref name.
 *  The old `[^A-Za-z0-9._-]` filter erased it to the empty string, so every
 *  non-ASCII branch's snapshot was called `detached-<stamp>`. */
test("a non-ASCII branch name survives into the salvage ref", () => {
  expect(salvageRef("修复/登录问题", new Date("2026-01-02T03:04:05Z"))).toBe(
    "refs/rove/salvage/修复-登录问题-20260102T030405Z",
  )
})
