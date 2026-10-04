/**
 * Base-ref ladder — the sidebar's drift chip is only honest if the branch it
 * measures against actually touched this work. A ref that RESOLVES is not
 * yet a base: an abandoned orphan `main` beside a live `develop` both exist,
 * and taking the first that resolves counts drift against history the task
 * never forked from.
 *
 * What has to hold: every candidate survives `git merge-base <ref> HEAD`, the
 * base checkout's own branch is the last resort, and the correctness costs
 * NOTHING on an idle tick — a verdict is re-taken only when HEAD or one of
 * the candidate refs has moved. The spawn count is measured through a `git`
 * shim on PATH, so it counts PROCESSES rather than trusting a stubbed spawn.
 */

import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { BASE_REF_TTL_MS, resetBaseRefCache, resolveBaseRefCached } from "../../src/core/base-ref-cache.ts"

const AUTHOR = ["-c", "user.email=t@t", "-c", "user.name=t"]
let root: string
let worktree: string
let counterFile: string
let realPath: string
const signal = new AbortController().signal

/** Runs the REAL git, bypassing the counting shim. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...AUTHOR, ...args], { cwd, encoding: "utf8", env: { ...process.env, PATH: realPath } })
    .toString()
    .trim()
}

/** `git` processes the code under test has spawned so far. */
function gitProcesses(): number {
  return readFileSync(counterFile, "utf8").split("\n").filter(Boolean).length
}

/**
 * Origin with `develop` as the real base and `main` as an ABANDONED ORPHAN
 * sharing no commit with it; a clone checked out on `develop`; one linked
 * worktree with a commit of its own. `origin/HEAD` is deliberately absent —
 * that is the shape in which the ladder falls through to its guesses.
 */
beforeEach(() => {
  realPath = process.env.PATH ?? ""
  root = mkdtempSync(join(tmpdir(), "kobe-baseref-"))
  const origin = join(root, "origin")
  mkdirSync(origin)
  git(origin, "init", "-q", "-b", "develop", ".")
  writeFileSync(join(origin, "base.txt"), "base\n")
  git(origin, "add", "-A")
  git(origin, "commit", "-qm", "base on develop")
  git(origin, "checkout", "-q", "--orphan", "main")
  git(origin, "rm", "-rq", "--cached", ".")
  rmSync(join(origin, "base.txt"))
  writeFileSync(join(origin, "orphan.txt"), "orphan\n")
  git(origin, "add", "-A")
  git(origin, "commit", "-qm", "abandoned orphan main")
  git(origin, "checkout", "-q", "develop")

  const clone = join(root, "clone")
  git(root, "clone", "-q", "--branch", "develop", origin, clone)
  git(clone, "branch", "main", "origin/main")
  rmSync(join(clone, ".git", "refs", "remotes", "origin", "HEAD"), { force: true })

  worktree = join(root, "wt")
  git(clone, "worktree", "add", "-q", "-b", "task", worktree, "develop")
  writeFileSync(join(worktree, "work.txt"), "work\n")
  git(worktree, "add", "-A")
  git(worktree, "commit", "-qm", "task work")

  const bin = join(root, "bin")
  mkdirSync(bin)
  counterFile = join(root, "spawns.log")
  writeFileSync(counterFile, "")
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8", env: { PATH: realPath } }).trim()
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$@" >> ${counterFile}\nexec ${realGit} "$@"\n`)
  chmodSync(join(bin, "git"), 0o755)
  process.env.PATH = `${bin}:${realPath}`
  resetBaseRefCache()
})

afterEach(() => {
  process.env.PATH = realPath
  rmSync(root, { recursive: true, force: true })
  resetBaseRefCache()
})

describe("resolveBaseRefCached", () => {
  test("skips a resolvable ref that shares no history and lands on the real base", async () => {
    // `origin/main` and `main` both resolve and both come earlier in the
    // ladder; neither has a merge-base with this branch.
    expect(git(worktree, "rev-parse", "--verify", "--quiet", "origin/main")).toBeTruthy()
    expect(await resolveBaseRefCached(worktree, undefined, signal)).toBe("develop")
  })

  test("a recorded base ref still wins outright", async () => {
    expect(await resolveBaseRefCached(worktree, "main", signal)).toBe("main")
  })

  test("renewing an unchanged worktree past the TTL spawns no git", async () => {
    const t0 = Date.now()
    expect(await resolveBaseRefCached(worktree, undefined, signal, t0)).toBe("develop")
    // Past the TTL with no ref moved: the fingerprint proves the verdict
    // still holds, so the answer comes back without a `merge-base`.
    const before = gitProcesses()
    expect(await resolveBaseRefCached(worktree, undefined, signal, t0 + BASE_REF_TTL_MS + 1)).toBe("develop")
    expect(gitProcesses()).toBe(before)
  })

  test("a moved HEAD past the TTL re-takes the verdict", async () => {
    const t0 = Date.now()
    expect(await resolveBaseRefCached(worktree, undefined, signal, t0)).toBe("develop")
    writeFileSync(join(worktree, "more.txt"), "more\n")
    git(worktree, "add", "-A")
    git(worktree, "commit", "-qm", "moved")
    const before = gitProcesses()
    expect(await resolveBaseRefCached(worktree, undefined, signal, t0 + BASE_REF_TTL_MS + 1)).toBe("develop")
    expect(gitProcesses()).toBeGreaterThan(before)
  })
})
