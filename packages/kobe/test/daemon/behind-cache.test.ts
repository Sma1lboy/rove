/**
 * Behind-count memo — `git rev-list --count HEAD..<base>` was half the
 * collector's process budget (570 of 1280 spawns in a 62-second idle
 * measurement) for an answer that can only move when HEAD or the base ref
 * moves. Both are ref files, so the memo is keyed on the two SHAs read off
 * disk.
 *
 * What has to hold: it must serve a hit ONLY while both shas are unchanged,
 * and it must never serve one it could not key properly — an unreadable sha
 * or a failed `rev-list` has to fall through to the real command every time,
 * because a stale drift count is worse than a slow one.
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { driftCached, resetBehindCache } from "../../src/core/behind-cache.ts"

const AUTHOR = ["-c", "user.email=t@t", "-c", "user.name=t"]
let repo: string

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kobe-behind-"))
  git("init", "-q", "-b", "main", ".")
  writeFileSync(join(repo, "a.txt"), "a\n")
  git("add", "-A")
  git(...AUTHOR, "commit", "-qm", "init")
  git("checkout", "-q", "-b", "work")
  resetBehindCache()
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
  resetBehindCache()
})

/** A `compute` that counts its calls and returns a fixed answer. */
function counter(value: number | null) {
  let calls = 0
  return {
    calls: () => calls,
    compute: async () => {
      calls++
      return value
    },
  }
}

describe("driftCached", () => {
  test("computes once, then serves the memo while both shas hold still", async () => {
    const c = counter(3)
    expect(await driftCached(repo, "main", c.compute)).toBe(3)
    expect(await driftCached(repo, "main", c.compute)).toBe(3)
    expect(await driftCached(repo, "main", c.compute)).toBe(3)
    expect(c.calls()).toBe(1)
  })

  test("recomputes when the BASE ref moves", async () => {
    const first = counter(0)
    expect(await driftCached(repo, "main", first.compute)).toBe(0)

    git("update-ref", "refs/heads/main", git(...AUTHOR, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "advance"))

    const second = counter(1)
    expect(await driftCached(repo, "main", second.compute)).toBe(1)
    expect(second.calls()).toBe(1)
  })

  test("recomputes when HEAD moves", async () => {
    const first = counter(2)
    expect(await driftCached(repo, "main", first.compute)).toBe(2)

    writeFileSync(join(repo, "b.txt"), "b\n")
    git("add", "-A")
    git(...AUTHOR, "commit", "-qm", "work commit")

    const second = counter(5)
    expect(await driftCached(repo, "main", second.compute)).toBe(5)
  })

  test("never memoises a failed compute", async () => {
    const failing = counter(null)
    expect(await driftCached(repo, "main", failing.compute)).toBeNull()
    expect(await driftCached(repo, "main", failing.compute)).toBeNull()
    expect(failing.calls()).toBe(2)
  })

  test("falls through every time when a sha will not read", async () => {
    // No such ref, so the key can never be formed — the memo must not
    // silently degrade into "same worktree, same answer".
    const c = counter(7)
    expect(await driftCached(repo, "origin/nope", c.compute)).toBe(7)
    expect(await driftCached(repo, "origin/nope", c.compute)).toBe(7)
    expect(c.calls()).toBe(2)
  })

  test("falls through for a path that is not a git checkout", async () => {
    const plain = mkdtempSync(join(tmpdir(), "kobe-behind-plain-"))
    const c = counter(1)
    expect(await driftCached(plain, "main", c.compute)).toBe(1)
    expect(await driftCached(plain, "main", c.compute)).toBe(1)
    expect(c.calls()).toBe(2)
    rmSync(plain, { recursive: true, force: true })
  })
})
