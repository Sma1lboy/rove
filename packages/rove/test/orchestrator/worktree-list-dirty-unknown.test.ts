/**
 * A failed `isDirty` probe must list as UNKNOWN, never as clean.
 *
 * `listManaged` and `listAllAdoptable` both catch the probe so one stale row
 * cannot dark the whole list — that catch stays. What it may not do is answer
 * `false`: a worktree holding uncommitted work whose `git status` says
 * `Permission denied` then lists identically to an empty one, and `dirty` is
 * what the Worktrees page and the adopt picker put in front of a user who is
 * about to delete it.
 */

import path from "node:path"
import { describe, expect, it } from "vitest"
import { listAllAdoptable, listManaged } from "../../src/orchestrator/worktree/manager-list.ts"
import { managedWorktreeRootsFor } from "../../src/orchestrator/worktree/paths.ts"

const REPO = "/repo"

/** Two worktrees under the managed root: `ok` probes fine, `bad` rejects. */
function porcelain(okPath: string, badPath: string): string {
  return [
    `worktree ${REPO}`,
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    `worktree ${okPath}`,
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/ok",
    "",
    `worktree ${badPath}`,
    "HEAD 3333333333333333333333333333333333333333",
    "branch refs/heads/bad",
    "",
  ].join("\n")
}

function deps(okPath: string, badPath: string) {
  return {
    ctxFor: () => ({ exec: { isRemote: false } as never, dir: REPO, remote: false }),
    runGitStdout: async () => porcelain(okPath, badPath),
    runGitStdoutAt: async () => "1700000000",
    isDirty: async (worktreePath: string) => {
      if (worktreePath === badPath) throw new Error("fatal: error opening '.git': Permission denied")
      return true
    },
  }
}

describe("a rejected isDirty probe", () => {
  // `listManaged` keeps only worktrees under a Rove-managed root, so both
  // fixtures have to live in the real one.
  const managedRoot = managedWorktreeRootsFor(REPO)[0] ?? ""
  const okPath = path.join(managedRoot, "ok")
  const badPath = path.join(managedRoot, "bad")

  it("lists managed worktrees with dirty: null, and keeps every other row", async () => {
    const rows = await listManaged(deps(okPath, badPath), REPO)
    const byBranch = new Map(rows.map((row) => [row.branch, row]))
    expect(byBranch.get("ok")?.dirty).toBe(true)
    // The whole point: not `false`.
    expect(byBranch.get("bad")?.dirty).toBeNull()
    expect(byBranch.get("bad")?.dirty).not.toBe(false)
  })

  it("lists adoptable worktrees with dirty: null, and keeps every other row", async () => {
    const rows = await listAllAdoptable(deps(okPath, badPath), REPO)
    const byBranch = new Map(rows.map((row) => [row.branch, row]))
    expect(byBranch.get("ok")?.dirty).toBe(true)
    expect(byBranch.get("bad")?.dirty).toBeNull()
    expect(byBranch.get("bad")?.dirty).not.toBe(false)
  })
})
