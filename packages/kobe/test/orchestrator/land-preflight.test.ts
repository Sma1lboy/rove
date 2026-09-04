/**
 * `landPreflight` — the read-only half of a land, over real git in a tmp repo
 * (same rationale as `land.test.ts`: the subject IS git's answers).
 *
 * `land.test.ts` already proves each refusal THROWS the right error out of
 * `landTask`. What is asserted here is the thing that error cannot carry and
 * the confirm dialog needs: the destination branch and the commit count, on
 * both the happy path and the refused ones.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { landPreflight } from "../../src/orchestrator/land-preflight.ts"
import type { Task } from "../../src/types/task.ts"
import { toTaskId } from "../../src/types/task.ts"

let tmpRoot: string
let repo: string

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`)
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: toTaskId("01TESTTESTTESTTESTTESTTEST"),
    title: "t",
    repo,
    branch: "feat",
    worktreePath: "",
    status: "idle",
    vendor: "claude",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  } as Task
}

/** A `feat` branch one commit ahead of `main`, base checkout back on `main`. */
function branchOneAhead(): void {
  git(["checkout", "-b", "feat"], repo)
  fs.writeFileSync(path.join(repo, "b.txt"), "feat\n")
  git(["add", "."], repo)
  git(["commit", "-m", "feat commit"], repo)
  git(["checkout", "main"], repo)
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-preflight-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  git(["init", "-b", "main"], repo)
  git(["config", "user.email", "t@t.t"], repo)
  git(["config", "user.name", "t"], repo)
  fs.writeFileSync(path.join(repo, "a.txt"), "base\n")
  git(["add", "."], repo)
  git(["commit", "-m", "base"], repo)
})

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // ignored
  }
})

describe("landPreflight", () => {
  test("names the destination and counts the commits that would land", async () => {
    branchOneAhead()
    const pf = await landPreflight(task())
    expect(pf).toMatchObject({ branch: "feat", landedOn: "main", ahead: 1, baseDirty: false })
    expect(pf.refusal).toBeUndefined()
  })

  test("the destination is the base checkout's CURRENT branch, not the default one", async () => {
    // The whole point of showing it: `docs/WORKTREES.md` tells you to check
    // this, and until the preflight there was no way to see it before merging.
    branchOneAhead()
    git(["checkout", "-b", "scratch-base"], repo)
    const pf = await landPreflight(task())
    expect(pf.landedOn).toBe("scratch-base")
    expect(pf.refusal).toBeUndefined()
  })

  test("detached base checkout refuses with DETACHED_HEAD and no branch to name", async () => {
    branchOneAhead()
    git(["checkout", "--detach"], repo)
    const pf = await landPreflight(task())
    expect(pf.refusal).toBe("DETACHED_HEAD")
    expect(pf.landedOn).toBe("")
  })

  test("base already on the task's branch refuses with SAME_BRANCH", async () => {
    branchOneAhead()
    git(["checkout", "feat"], repo)
    expect((await landPreflight(task())).refusal).toBe("SAME_BRANCH")
  })

  test("dirty base refuses with MAIN_CHECKOUT_DIRTY, and still reports the count", async () => {
    branchOneAhead()
    fs.writeFileSync(path.join(repo, "a.txt"), "edited\n")
    const pf = await landPreflight(task())
    expect(pf).toMatchObject({ refusal: "MAIN_CHECKOUT_DIRTY", baseDirty: true, landedOn: "main", ahead: 1 })
  })

  test("a branch git cannot resolve refuses with MISSING_REF and no count", async () => {
    branchOneAhead()
    git(["branch", "-m", "feat", "feat-renamed"], repo)
    const pf = await landPreflight(task())
    expect(pf.refusal).toBe("MISSING_REF")
    expect(pf.ahead).toBeUndefined()
  })

  test("zero commits ahead with no worktree is the plain empty-branch no-op", async () => {
    git(["branch", "feat"], repo)
    const pf = await landPreflight(task())
    expect(pf).toMatchObject({ refusal: "EMPTY_BRANCH", ahead: 0, landedOn: "main" })
  })

  test("zero commits ahead with a dirty worktree names the uncommitted files", async () => {
    const wt = path.join(tmpRoot, "wt")
    git(["worktree", "add", "-b", "feat", wt], repo)
    fs.writeFileSync(path.join(wt, "uncommitted.txt"), "work\n")
    const pf = await landPreflight(task({ worktreePath: wt }))
    expect(pf.refusal).toBe("EMPTY_BRANCH_DIRTY_WORKTREE")
    expect(pf.dirtyFiles).toContain("uncommitted.txt")
  })

  test("a refusal carries the message the land itself would have thrown", async () => {
    // The confirm and `--dry-run` report `message` verbatim, so it must be the
    // land's own words rather than a second wording that can drift from it.
    git(["branch", "feat"], repo)
    const pf = await landPreflight(task())
    expect(pf.message).toContain("EMPTY_BRANCH")
    expect(pf.message).toContain("feat")
  })
})
