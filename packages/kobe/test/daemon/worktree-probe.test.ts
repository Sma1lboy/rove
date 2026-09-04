/**
 * The worktree change probe, against REAL git repos — including a linked
 * worktree, whose `.git` is a file and whose refs live in the main
 * checkout's common dir.
 *
 * Two halves matter, and the second is the one that keeps the collector
 * correct:
 *
 *   1. what the fingerprint DOES notice (staging, commits, ref moves, an
 *      entry created in the worktree root) — the accelerator;
 *   2. what it does NOT (a content edit of an existing file, a new file in a
 *      subdirectory) — which is why the collector keeps a safety poll behind
 *      it rather than treating a quiet probe as proof of no change.
 *
 * `mtime` has coarse granularity on some filesystems, so every mutation is
 * preceded by a short sleep rather than trusting sub-millisecond stamps.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readHeadSha, readRefSha, resolveGitDirs, worktreeFingerprint } from "@sma1lboy/kobe-daemon/daemon/worktree-probe"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

const AUTHOR = ["-c", "user.email=t@t", "-c", "user.name=t"]
const dirs: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kobe-probe-"))
  dirs.push(dir)
  git(dir, "init", "-q", "-b", "main", ".")
  mkdirSync(join(dir, "src", "deep"), { recursive: true })
  writeFileSync(join(dir, "src", "deep", "f.ts"), "base\n")
  writeFileSync(join(dir, "root.txt"), "root\n")
  git(dir, "add", "-A")
  git(dir, ...AUTHOR, "commit", "-qm", "init")
  return dir
}

/** mtime resolution is only guaranteed to ~1s on some filesystems. */
function pause(): void {
  execFileSync("sleep", ["1.1"])
}

describe("worktreeFingerprint", () => {
  let repo: string

  beforeAll(() => {
    repo = newRepo()
  })
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  test("is stable across reads when nothing happens", () => {
    expect(worktreeFingerprint(repo)).toBe(worktreeFingerprint(repo))
  })

  test("is null for a directory that is not a git checkout", () => {
    const plain = mkdtempSync(join(tmpdir(), "kobe-probe-plain-"))
    dirs.push(plain)
    expect(worktreeFingerprint(plain)).toBeNull()
  })

  test("moves when a file is staged", () => {
    const before = worktreeFingerprint(repo)
    pause()
    writeFileSync(join(repo, "staged.txt"), "s\n")
    git(repo, "add", "staged.txt")
    expect(worktreeFingerprint(repo)).not.toBe(before)
  })

  test("moves when HEAD commits", () => {
    const before = worktreeFingerprint(repo)
    pause()
    git(repo, ...AUTHOR, "commit", "-qm", "second")
    expect(worktreeFingerprint(repo)).not.toBe(before)
  })

  test("moves when a default base ref moves, even with no recorded baseRef", () => {
    // The task usually records no base; the runner resolves `main`/`origin/main`
    // later. The fingerprint has to watch those files anyway or a fetch that
    // advanced the base is invisible until the safety poll.
    git(repo, "branch", "-f", "otherbase", "HEAD")
    git(repo, "checkout", "-q", "-b", "work")
    const before = worktreeFingerprint(repo)
    pause()
    git(repo, "update-ref", "refs/heads/main", git(repo, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "advance"))
    expect(worktreeFingerprint(repo)).not.toBe(before)
  })

  test("moves when an entry is created in the worktree root", () => {
    const before = worktreeFingerprint(repo)
    pause()
    writeFileSync(join(repo, "brand-new.txt"), "n\n")
    expect(worktreeFingerprint(repo)).not.toBe(before)
  })

  test("does NOT move for a content edit of an existing file — the blind spot", () => {
    // Both of these are real `git status` changes the probe cannot see. The
    // collector's safety poll is what covers them; if this ever starts
    // failing, the safety poll may be relaxed.
    const before = worktreeFingerprint(repo)
    pause()
    writeFileSync(join(repo, "root.txt"), "root edited\n")
    writeFileSync(join(repo, "src", "deep", "f.ts"), "nested edited\n")
    expect(worktreeFingerprint(repo)).toBe(before)
    expect(git(repo, "status", "--porcelain=v1")).toContain("root.txt")
  })

  test("works for a LINKED worktree, whose .git is a file", () => {
    const linked = join(repo, "..", `linked-${Date.now()}`)
    git(repo, "worktree", "add", "-q", "-b", "linkedbr", linked)
    dirs.push(linked)
    const probeDirs = resolveGitDirs(linked)
    expect(probeDirs).not.toBeNull()
    // A linked worktree keeps its own gitDir but shares the repo-wide one.
    expect(probeDirs?.gitDir).not.toBe(probeDirs?.commonDir)
    expect(worktreeFingerprint(linked)).not.toBeNull()
    expect(readHeadSha(probeDirs as NonNullable<typeof probeDirs>)).toBe(git(linked, "rev-parse", "HEAD"))
    git(repo, "worktree", "remove", "--force", linked)
  })
})

describe("ref reads", () => {
  let repo: string

  beforeAll(() => {
    repo = newRepo()
  })

  test("readHeadSha follows the symref, and matches rev-parse", () => {
    const probeDirs = resolveGitDirs(repo)
    expect(probeDirs).not.toBeNull()
    expect(readHeadSha(probeDirs as NonNullable<typeof probeDirs>)).toBe(git(repo, "rev-parse", "HEAD"))
  })

  test("readRefSha finds a branch both loose and packed", () => {
    const probeDirs = resolveGitDirs(repo) as NonNullable<ReturnType<typeof resolveGitDirs>>
    const expected = git(repo, "rev-parse", "main")
    expect(readRefSha(probeDirs, "main")).toBe(expected)
    // `pack-refs` deletes the loose file — the packed-refs path must cover it.
    git(repo, "pack-refs", "--all")
    expect(readRefSha(probeDirs, "main")).toBe(expected)
  })

  test("readRefSha is null for a ref that does not exist", () => {
    const probeDirs = resolveGitDirs(repo) as NonNullable<ReturnType<typeof resolveGitDirs>>
    expect(readRefSha(probeDirs, "origin/nope")).toBeNull()
  })
})
