/**
 * GitWorktreeManager error/edge branches that worktree.test.ts's happy
 * paths never provoke: the cwd guard, the stale-directory conflict on
 * create, remove() on a non-worktree, detached-HEAD currentBranch, the
 * gone-directory remove (metadata prune path), and the absolute-path
 * argument guards. Real temp git repos, same conventions as the sibling
 * suite.
 */

import { execSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let root: string
let repo: string
let manager: GitWorktreeManager
/** `<home>/.rove/worktrees` for the temp home below — the root that makes a
 *  path Rove's to delete outright (see isUnderManagedWorktreesRoot). */
let managedRoot: string
let previousHome: string | undefined

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "kobe-wtm-edge-")))
  // The managed-roots guard reads `$KOBE_HOME_DIR`; point it at the temp root
  // so the orphaned-worktree cases below exercise a REAL managed root instead
  // of the developer's own `~/.rove`.
  previousHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = root
  // `<worktrees-root>/<repo-key>/<slug>` — the shape `worktreePathFor`
  // actually creates, and the only one `isUnderManagedWorktreesRoot`
  // accepts as authorization to delete outright.
  managedRoot = join(root, ".rove", "worktrees", "repo-0123456789ab")
  mkdirSync(managedRoot, { recursive: true })
  repo = join(root, "repo")
  mkdirSync(repo)
  execSync("git init -q -b main && git commit -q --allow-empty -m init", { cwd: repo, env: gitEnv })
  manager = new GitWorktreeManager()
})

afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = previousHome
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

  it("remove({force}) deletes a worktree whose upstream repo is gone", async () => {
    // Field report: macOS pruned a checkout under `/tmp`, taking its `.git`
    // with it. The orphaned worktree then had no resolvable owning repo, so
    // `git worktree remove` could never run — the task sat in
    // `deletion.phase: "error"` and every retry re-ran the same
    // unsatisfiable path, with no supported command able to clear it.
    const owner = join(root, "doomed-repo")
    mkdirSync(owner)
    execSync("git init -q -b main && git commit -q --allow-empty -m init", { cwd: owner, env: gitEnv })
    // Under a managed root, which is what authorizes the outright delete.
    const wt = join(managedRoot, "orphaned")
    await manager.create(owner, "kobe/orphaned", wt)
    writeFileSync(join(wt, "output.txt"), "work")
    rmSync(join(owner, ".git"), { recursive: true, force: true }) // upstream dies

    await expect(manager.remove(wt, { force: true })).resolves.toBeUndefined()
    expect(existsSync(wt)).toBe(false)
  })

  it("remove() without force still refuses an orphaned worktree", async () => {
    // `force` is what carries the "delete it even though I cannot verify
    // what's inside" consent. Without it the unresolvable repo stays an error
    // and the directory stays put.
    const owner = join(root, "doomed-repo-2")
    mkdirSync(owner)
    execSync("git init -q -b main && git commit -q --allow-empty -m init", { cwd: owner, env: gitEnv })
    const wt = join(managedRoot, "orphaned-keep")
    await manager.create(owner, "kobe/orphaned-keep", wt)
    rmSync(join(owner, ".git"), { recursive: true, force: true })

    await expect(manager.remove(wt)).rejects.toThrow(/is not a git worktree/)
    expect(existsSync(wt)).toBe(true)
  })

  it("remove({force}) refuses a sibling project sitting directly under the worktrees root", async () => {
    // A user who points Settings → Worktree location at `~` or `~/code` makes
    // the root an ancestor of every project they own. Depth is what separates
    // "Rove made this" from "the user's checkout happens to live below the
    // root": Rove only ever creates `<root>/<repo-key>/<slug>`, so a directory
    // one level down is somebody else's, and force is not permission to
    // `rm -rf` it.
    const sibling = join(root, ".rove", "worktrees", "my-other-project")
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(sibling, "important.txt"), "not rove's")

    await expect(manager.remove(sibling, { force: true })).rejects.toThrow(/not under a Rove worktrees root/)
    expect(existsSync(join(sibling, "important.txt"))).toBe(true)
  })

  it("remove({force}) refuses an orphaned directory outside the managed roots", async () => {
    // The guard that keeps this from becoming "force deletes any path": an
    // unreachable repo plus force is still not permission to delete a
    // directory Rove never created.
    const owner = join(root, "doomed-repo-3")
    mkdirSync(owner)
    execSync("git init -q -b main && git commit -q --allow-empty -m init", { cwd: owner, env: gitEnv })
    const wt = join(root, "outside-managed") // NOT under a managed root
    await manager.create(owner, "kobe/outside", wt)
    rmSync(join(owner, ".git"), { recursive: true, force: true })

    await expect(manager.remove(wt, { force: true })).rejects.toThrow(/not under a Rove worktrees root/)
    expect(existsSync(wt)).toBe(true)
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

describe("renameBranch() convergence", () => {
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

/**
 * `remove({ deleteBranch })` against REAL git. Every other layer (api handler →
 * daemon → coordinator) asserts the flag as a value being passed along; this is
 * the only place that asks git whether the branch is actually still there.
 */
describe("remove({ deleteBranch }) — the branch actually lives or dies", () => {
  function branchExists(name: string): boolean {
    const out = execSync(`git branch --list ${JSON.stringify(name)}`, { cwd: repo, env: gitEnv, encoding: "utf8" })
    return out.trim().length > 0
  }

  it("deleteBranch: true removes the branch from the owning repo", async () => {
    const wt = join(root, "wt-branch-doomed")
    await manager.create(repo, "kobe/doomed", wt)
    expect(branchExists("kobe/doomed")).toBe(true)

    await manager.remove(wt, { deleteBranch: true })

    // Red if `deleteBranchIn` is never reached — including if the HEAD capture
    // moves to AFTER the worktree is removed (manager.ts:225-228): the
    // worktree is gone by then, `currentBranch` throws, the `.catch(() => null)`
    // makes `branch` null and the delete is silently skipped.
    expect(branchExists("kobe/doomed")).toBe(false)
  })

  it("without the opt-in the branch survives — git is the durable record", async () => {
    const wt = join(root, "wt-branch-kept")
    await manager.create(repo, "kobe/kept", wt)

    await manager.remove(wt)

    expect(branchExists("kobe/kept")).toBe(true)
  })

  it("an unmerged branch is refused by `-d` and force escalates to `-D`", async () => {
    // The `-d`/`-D` choice in manager-branch.ts:50. Swap the ternary and both
    // halves of this go red: `-D` would nuke the unmerged branch on the
    // no-force path, `-d` would refuse it on the force path.
    const wt = join(root, "wt-branch-unmerged")
    await manager.create(repo, "kobe/unmerged", wt)
    writeFileSync(join(wt, "work.txt"), "unmerged work")
    execSync("git add -A && git commit -q -m work", { cwd: wt, env: gitEnv })

    // Safe delete: the commit isn't on main, so `-d` refuses. Best-effort —
    // the refusal is swallowed and the worktree removal still succeeds.
    await manager.remove(wt, { deleteBranch: true })
    expect(branchExists("kobe/unmerged")).toBe(true)

    // Same branch, re-materialised, this time with force: `-D` drops it.
    const wt2 = join(root, "wt-branch-unmerged-2")
    await manager.create(repo, "kobe/unmerged", wt2)
    await manager.remove(wt2, { force: true, deleteBranch: true })
    expect(branchExists("kobe/unmerged")).toBe(false)
  })
})
