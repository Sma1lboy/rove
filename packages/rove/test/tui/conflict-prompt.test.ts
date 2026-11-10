/**
 * Paused-operation detection against real git: a conflicted merge in a linked
 * worktree (the shape a conflicted "Sync with base" leaves) and a conflicted
 * rebase, which also writes markers a naive check would read as a merge.
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildConflictPrompt, conflictedPaths, pausedGitOperation } from "../../src/tui/ops/conflict-prompt"

const ID = ["-c", "user.email=t@t", "-c", "user.name=t"]

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", [...ID, ...args], { cwd, stdio: "ignore" })
}

function tryGit(cwd: string, ...args: string[]): void {
  try {
    git(cwd, ...args)
  } catch {
    // The conflict is the point.
  }
}

/** A repo whose `main` and `feature` both rewrite `a.txt`; `feature` is checked out in a linked worktree. */
function divergedRepo(): { repo: string; worktree: string } {
  const repo = mkdtempSync(join(tmpdir(), "rove-conflict-"))
  git(repo, "init", "-q", "-b", "main")
  writeFileSync(join(repo, "a.txt"), "base\n")
  git(repo, "add", ".")
  git(repo, "commit", "-q", "-m", "base")
  const worktree = join(repo, "..", `${repo.split("/").pop()}-wt`)
  git(repo, "worktree", "add", "-q", "-b", "feature", worktree)
  writeFileSync(join(worktree, "a.txt"), "feature\n")
  git(worktree, "commit", "-q", "-am", "feature")
  writeFileSync(join(repo, "a.txt"), "main\n")
  git(repo, "commit", "-q", "-am", "main")
  return { repo, worktree }
}

describe("pausedGitOperation", () => {
  test("is null for a clean worktree and a path with no git", () => {
    const { worktree } = divergedRepo()
    expect(pausedGitOperation(worktree)).toBeNull()
    expect(pausedGitOperation(mkdtempSync(join(tmpdir(), "rove-nogit-")))).toBeNull()
    expect(pausedGitOperation("")).toBeNull()
  })

  test("reads a conflicted merge in a linked worktree, and lists its files", async () => {
    const { worktree } = divergedRepo()
    tryGit(worktree, "merge", "main")
    expect(pausedGitOperation(worktree)).toBe("merge")
    expect(await conflictedPaths(worktree)).toEqual(["a.txt"])
    git(worktree, "merge", "--abort")
    expect(pausedGitOperation(worktree)).toBeNull()
  })

  test("names a conflicted rebase a rebase", () => {
    const { worktree } = divergedRepo()
    tryGit(worktree, "rebase", "main")
    expect(pausedGitOperation(worktree)).toBe("rebase")
  })
})

describe("buildConflictPrompt", () => {
  test("names the files and the command that finishes the operation", () => {
    const text = buildConflictPrompt({ operation: "rebase", branch: "feature", files: ["a.txt", "b/c.ts"] })
    expect(text).toContain("- a.txt\n- b/c.ts")
    expect(text).toContain("git rebase --continue")
    expect(text).toContain("The current branch is feature.")
  })

  test("says so when git reports nothing unmerged", () => {
    expect(buildConflictPrompt({ operation: "merge", branch: "feature", files: [] })).toContain("no unmerged files")
  })
})
