/**
 * GitWorktreeManager error/edge branches that worktree.test.ts's happy
 * paths never provoke: the cwd guard, the stale-directory conflict on
 * create, remove() on a non-worktree, detached-HEAD currentBranch, the
 * gone-directory remove (metadata prune path), and the absolute-path
 * argument guards. Real temp git repos, same conventions as the sibling
 * suite.
 */

import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let root: string
let repo: string
let manager: GitWorktreeManager

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "kobe-wtm-edge-")))
  repo = join(root, "repo")
  mkdirSync(repo)
  execSync("git init -q -b main && git commit -q --allow-empty -m init", { cwd: repo, env: gitEnv })
  manager = new GitWorktreeManager()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("create() conflicts", () => {
  it("refuses a target dir that exists but is not a registered worktree", async () => {
    const stale = join(root, "stale-dir")
    mkdirSync(stale)
    writeFileSync(join(stale, "user-file.txt"), "precious")
    await expect(manager.create(repo, "kobe/stale", stale)).rejects.toThrow(
      /exists but is not a registered git worktree/,
    )
    // the user's files were NOT nuked
    expect(() => execSync(`ls ${JSON.stringify(join(stale, "user-file.txt"))}`)).not.toThrow()
  })

  it("rejects relative paths outright", async () => {
    await expect(manager.create("relative/repo", "b", join(root, "x"))).rejects.toThrow(/absolute path/)
    await expect(manager.create(repo, "b", "relative/wt")).rejects.toThrow(/absolute path/)
  })
})

describe("remove() / currentBranch() edges", () => {
  it("remove() on a directory that is not a worktree surfaces the fact", async () => {
    const plain = join(root, "plain-dir")
    mkdirSync(plain)
    await expect(manager.remove(plain)).rejects.toThrow(/is not a git worktree/)
  })

  it("remove() of an already-deleted worktree dir resolves quietly (best-effort prune)", async () => {
    const wt = join(root, "wt-gone")
    await manager.create(repo, "kobe/gone", wt)
    rmSync(wt, { recursive: true, force: true }) // the dir vanishes out-of-band
    // The gone-dir path must never throw — deleting an already-deleted
    // worktree is a no-op from the caller's perspective. (Metadata pruning
    // is best-effort: with the dir gone, the owning repo may not be
    // resolvable from the path at all, so a stale `.git/worktrees/` entry
    // is allowed to linger for git's own gc.)
    await expect(manager.remove(wt)).resolves.toBeUndefined()
  })

  it("currentBranch() rejects a detached-HEAD worktree explicitly", async () => {
    const wt = join(root, "wt-detached")
    await manager.create(repo, "kobe/detach-me", wt)
    execSync("git checkout -q --detach", { cwd: wt, env: gitEnv })
    await expect(manager.currentBranch(wt)).rejects.toThrow(/detached-HEAD/)
  })
})

describe("renameBranch() convergence (issue #44)", () => {
  it("resolves when the recorded old name is stale but the branch already carries the new name", async () => {
    const wt = join(root, "wt-stale-rename")
    await manager.create(repo, "rename-old", wt)
    // Out-of-band rename in the worktree — what a retried set-branch whose
    // first attempt renamed-but-lost-its-response leaves behind.
    execSync("git branch -m rename-old rename-new", { cwd: wt, env: gitEnv })
    await expect(manager.renameBranch(wt, "rename-old", "rename-new")).resolves.toBeUndefined()
    expect(await manager.currentBranch(wt)).toBe("rename-new")
  })

  it("still fails when neither the old nor the new name exists", async () => {
    const wt = join(root, "wt-rename-missing")
    await manager.create(repo, "rename-anchor", wt)
    await expect(manager.renameBranch(wt, "no-such-old", "no-such-new")).rejects.toThrow(/branch -m/)
  })

  it("still fails on a collision with a different existing branch", async () => {
    const wt = join(root, "wt-rename-collide")
    await manager.create(repo, "rename-a", wt)
    execSync("git branch rename-b", { cwd: repo, env: gitEnv })
    await expect(manager.renameBranch(wt, "rename-a", "rename-b")).rejects.toThrow(/branch -m/)
    expect(await manager.currentBranch(wt)).toBe("rename-a")
  })
})
