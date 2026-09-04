/**
 * Committed-work signals behind `collect` (branch-signals.ts): base-ref
 * resolution order, shortstat parsing, and the end-to-end read against a
 * real throwaway repo — the seam that makes "pick the fan-out winner"
 * possible once attempts start committing (uncommitted counts read 0/0).
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseShortstat, readBranchSignals, resolveBaseRef } from "../../src/cli/api/branch-signals.ts"

const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], { cwd, stdio: "ignore" })
}

/** Repo with a `main` base and a task branch carrying one committed change. */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "kobe-branch-signals-"))
  cleanups.push(repo)
  git(repo, "init", "-q", "-b", "main")
  writeFileSync(join(repo, "a.txt"), "one\n")
  git(repo, "add", "a.txt")
  git(repo, "commit", "-q", "-m", "base")
  git(repo, "checkout", "-q", "-b", "kobe/task")
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n")
  writeFileSync(join(repo, "b.txt"), "new\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "attempt work")
  return repo
}

describe("parseShortstat", () => {
  it("parses all three clauses", () => {
    expect(parseShortstat(" 3 files changed, 40 insertions(+), 2 deletions(-)")).toEqual({
      files: 3,
      insertions: 40,
      deletions: 2,
    })
  })

  it("tolerates missing clauses and the singular forms", () => {
    expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({ files: 1, insertions: 1, deletions: 0 })
    expect(parseShortstat("")).toEqual({ files: 0, insertions: 0, deletions: 0 })
  })
})

describe("readBranchSignals", () => {
  it("reports ahead count + committed diffstat vs the local main base", () => {
    const repo = makeRepo()
    const signals = readBranchSignals(repo)
    expect(signals.baseRef).toBe("main")
    expect(signals.ahead).toBe(1)
    expect(signals.diff).toEqual({ files: 2, insertions: 2, deletions: 0 })
  })

  it("yields nulls (never throws) outside a git repo or with no base", () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-branch-signals-plain-"))
    cleanups.push(dir)
    expect(readBranchSignals(dir)).toEqual({ baseRef: null, ahead: null, behind: null, diff: null })
    expect(readBranchSignals("")).toEqual({ baseRef: null, ahead: null, behind: null, diff: null })
    expect(resolveBaseRef(dir)).toBeNull()
  })
})

describe("a ladder hit that shares no history with the branch", () => {
  /**
   * The shape that made `collect` report `ahead: 5, behind: 1, diff: null` for
   * a task holding ONE commit: an abandoned orphan `main` sitting beside the
   * repo's real base, `develop`. Both branches resolve; they have no merge
   * base at all, so every number measured against `main` is fabricated and the
   * null diffstat is the only tell — the one field a fan-out coordinator
   * reading `ahead` does not look at.
   */
  function makeOrphanMainRepo(): { repo: string; worktree: string } {
    const repo = mkdtempSync(join(tmpdir(), "kobe-branch-signals-orphan-"))
    cleanups.push(repo)
    git(repo, "init", "-q", "-b", "develop")
    writeFileSync(join(repo, "a.txt"), "one\n")
    git(repo, "add", "a.txt")
    git(repo, "commit", "-q", "-m", "develop base")
    // An orphan `main`: no shared history with `develop` by construction.
    git(repo, "checkout", "-q", "--orphan", "main")
    git(repo, "rm", "-rqf", ".")
    writeFileSync(join(repo, "OLD.md"), "old\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "abandoned main")
    git(repo, "checkout", "-q", "develop")
    // A linked worktree, so the base checkout stays on `develop` — the layout
    // every managed task has, and the one `git worktree list` can answer for.
    const worktree = join(repo, "..", `${basename(repo)}-wt`)
    cleanups.push(worktree)
    git(repo, "worktree", "add", "-q", "-b", "task", worktree)
    writeFileSync(join(worktree, "one.txt"), "one\n")
    git(worktree, "add", "-A")
    git(worktree, "commit", "-q", "-m", "the ONE commit")
    return { repo, worktree }
  }

  it("skips it and measures against the base checkout's real branch", () => {
    const { worktree } = makeOrphanMainRepo()
    const signals = readBranchSignals(worktree)
    expect(signals.baseRef).toBe("develop")
    expect(signals.ahead).toBe(1)
    expect(signals.behind).toBe(0)
    expect(signals.diff).toEqual({ files: 1, insertions: 1, deletions: 0 })
  })

  it("finds a default branch the ladder never names (`trunk`, no remote)", () => {
    const repo = mkdtempSync(join(tmpdir(), "kobe-branch-signals-trunk-"))
    cleanups.push(repo)
    git(repo, "init", "-q", "-b", "trunk")
    writeFileSync(join(repo, "a.txt"), "one\n")
    git(repo, "add", "a.txt")
    git(repo, "commit", "-q", "-m", "trunk base")
    const worktree = join(repo, "..", `${basename(repo)}-wt`)
    cleanups.push(worktree)
    git(repo, "worktree", "add", "-q", "-b", "task", worktree)
    writeFileSync(join(worktree, "t.txt"), "t\n")
    git(worktree, "add", "-A")
    git(worktree, "commit", "-q", "-m", "task work")
    const signals = readBranchSignals(worktree)
    // Was all-null: `main`/`master` do not exist and there is no remote, so
    // the ladder ran out — while `land --dry-run` on the same task answered
    // `landedOn: "trunk", ahead: 1` from the base checkout all along.
    expect(signals.baseRef).toBe("trunk")
    expect(signals.ahead).toBe(1)
  })
})

describe("readBranchSignals with a recorded baseRef", () => {
  /**
   * main (A) → release/2.x (adds B) → kobe/task cut FROM release/2.x (adds
   * C). The base guess resolves local `main`; the recorded fork point is
   * `release/2.x` — measuring against the guess over-counts ahead and
   * folds the release work into the task's diffstat.
   */
  function makeForkedRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), "kobe-branch-signals-forked-"))
    cleanups.push(repo)
    git(repo, "init", "-q", "-b", "main")
    writeFileSync(join(repo, "a.txt"), "one\n")
    git(repo, "add", "a.txt")
    git(repo, "commit", "-q", "-m", "base")
    git(repo, "checkout", "-q", "-b", "release/2.x")
    writeFileSync(join(repo, "release.txt"), "rel\n")
    git(repo, "add", "release.txt")
    git(repo, "commit", "-q", "-m", "release work")
    git(repo, "checkout", "-q", "-b", "kobe/task")
    writeFileSync(join(repo, "task.txt"), "task\n")
    git(repo, "add", "task.txt")
    git(repo, "commit", "-q", "-m", "task work")
    return repo
  }

  it("measures against the recorded fork point instead of the guess", () => {
    const repo = makeForkedRepo()
    const signals = readBranchSignals(repo, "release/2.x")
    expect(signals.baseRef).toBe("release/2.x")
    expect(signals.ahead).toBe(1)
    expect(signals.diff).toEqual({ files: 1, insertions: 1, deletions: 0 })
    // Sanity anchor: with NO record the guess resolves local main and
    // over-counts (2 ahead, release work folded into the diffstat).
    const guessed = readBranchSignals(repo)
    expect(guessed.baseRef).toBe("main")
    expect(guessed.ahead).toBe(2)
  })

  it("falls back to the guess when the recorded ref no longer resolves", () => {
    const repo = makeForkedRepo()
    const signals = readBranchSignals(repo, "deleted-branch")
    expect(signals.baseRef).toBe("main")
    expect(signals.ahead).toBe(2)
  })
})
