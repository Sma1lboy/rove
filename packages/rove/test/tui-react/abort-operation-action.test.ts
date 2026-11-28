/**
 * Row-menu "Abort paused merge or rebase" against real git: a confirmed abort
 * puts the branch back, a cancelled one leaves the operation paused.
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { abortOperationAction } from "../../src/tui-react/workspace/abort-operation-action"
import { pausedGitOperation } from "../../src/tui/ops/conflict-prompt"

const ID = ["-c", "user.email=t@t", "-c", "user.name=t"]

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...ID, ...args], { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString()
}

/** `feature` (in a linked worktree) and `main` both rewrite `a.txt`, then `feature` stops rebasing onto `main`. */
function pausedRebase(): { worktree: string; head: string } {
  const repo = mkdtempSync(join(tmpdir(), "rove-abort-"))
  git(repo, "init", "-q", "-b", "main")
  writeFileSync(join(repo, "a.txt"), "base\n")
  git(repo, "add", ".")
  git(repo, "commit", "-q", "-m", "base")
  const worktree = `${repo}-wt`
  git(repo, "worktree", "add", "-q", "-b", "feature", worktree)
  writeFileSync(join(worktree, "a.txt"), "feature\n")
  git(worktree, "commit", "-q", "-am", "feature")
  writeFileSync(join(repo, "a.txt"), "main\n")
  git(repo, "commit", "-q", "-am", "main")
  const head = git(worktree, "rev-parse", "HEAD").trim()
  expect(() => git(worktree, "rebase", "main")).toThrow()
  return { worktree, head }
}

function deps(answer: boolean) {
  const info: string[] = []
  const errors: string[] = []
  const asked: string[] = []
  return {
    info,
    errors,
    asked,
    deps: {
      confirm: async (title: string) => {
        asked.push(title)
        return answer
      },
      notifyInfo: (message: string) => void info.push(message),
      notifyError: (message: string) => void errors.push(message),
      t: (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`,
    },
  }
}

describe("abortOperationAction", () => {
  test("a confirmed abort puts the branch back where it was before the rebase", async () => {
    const { worktree, head } = pausedRebase()
    const run = deps(true)
    await abortOperationAction(run.deps, worktree, "feature")
    expect(run.asked).toEqual(['tasks.abortOp.title{"op":"rebase","branch":"feature"}'])
    expect(pausedGitOperation(worktree)).toBeNull()
    expect(git(worktree, "rev-parse", "HEAD").trim()).toBe(head)
    expect(git(worktree, "branch", "--show-current").trim()).toBe("feature")
    expect(readFileSync(join(worktree, "a.txt"), "utf8")).toBe("feature\n")
    expect(run.info).toEqual(['tasks.abortOp.done{"op":"rebase","branch":"feature"}'])
    expect(run.errors).toEqual([])
  })

  test("cancelling the confirm leaves the operation paused", async () => {
    const { worktree } = pausedRebase()
    const run = deps(false)
    await abortOperationAction(run.deps, worktree, "feature")
    expect(pausedGitOperation(worktree)).toBe("rebase")
    expect(run.info).toEqual([])
    expect(run.errors).toEqual([])
  })

  test("says nothing is paused, without asking, once the operation already finished", async () => {
    const { worktree } = pausedRebase()
    git(worktree, "rebase", "--abort")
    const run = deps(true)
    await abortOperationAction(run.deps, worktree, "feature")
    expect(run.asked).toEqual([])
    expect(run.errors).toEqual(["files.toast.noPausedOperation"])
  })
})
