/**
 * `remove()` when git's two jobs — deregister the metadata, delete the
 * directory — succeed apart.
 *
 * Real git, real `chmod -w`: an unwritable directory inside a worktree makes
 * `git worktree remove --force` exit 255 AFTER it has already deregistered the
 * worktree. Reading the exit code as the whole truth reports that as a total
 * failure and leaves every retry fatal (`is not a working tree`), parking the
 * task in `deletion.phase = "error"` forever.
 *
 * These are the only tests that ask GIT what actually happened rather than
 * asserting on a mock's arguments — a stub cannot produce the split.
 */

import { execSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { WorktreeResidue } from "../../src/orchestrator/worktree/manager-remove.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let root: string
let repo: string
let manager: GitWorktreeManager
/** `<home>/.rove/worktrees` for the temp home — the root that authorizes the
 *  orphaned-worktree `rm -rf` this file's residues must never fall into. */
let managedRoot: string
let previousHome: string | undefined
/** Paths chmod'd read-only, restored in afterEach so cleanup can delete them. */
const locked: string[] = []

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

/** A worktree whose `fixture/` subdir cannot be unlinked — the shape that
 *  makes git deregister-but-not-delete. */
function undeletableWorktree(name: string, branch: string): string {
  // Under the managed root because that is where a real Rove worktree lives —
  // and on platforms whose git unlinks the `.git` pointer before failing, the
  // retry's convergence runs through the managed-root path.
  const wt = join(managedRoot, name)
  execSync(`git worktree add -q ${JSON.stringify(wt)} -b ${branch}`, { cwd: repo, env: gitEnv })
  const fixture = join(wt, "fixture")
  mkdirSync(fixture, { recursive: true })
  // Directly under the locked dir, not in a writable child: unlinking needs
  // WRITE on the parent, so this file is the part git provably cannot take.
  writeFileSync(join(fixture, "keep.txt"), "x")
  chmodSync(fixture, 0o555)
  locked.push(fixture)
  return wt
}

function registered(worktreePath: string): boolean {
  const out = execSync("git worktree list --porcelain", { cwd: repo, env: gitEnv, encoding: "utf8" })
  return out.split("\n").some((l) => l === `worktree ${worktreePath}` || l === `worktree ${realpathSync(repo)}/../x`)
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "kobe-wt-partial-")))
  // The managed-roots guard reads `$KOBE_HOME_DIR`. Pointing it at the temp
  // root is what lets the ordering test below put a residue INSIDE a real
  // managed root — the one place the orphan branch would delete it.
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

afterEach(() => {
  for (const p of locked.splice(0)) {
    try {
      chmodSync(p, 0o755)
    } catch {
      // already gone — the test that locked it removed the tree
    }
  }
})

afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = previousHome
  rmSync(root, { recursive: true, force: true })
})

describe("remove() when git deregisters but cannot delete", () => {
  it("resolves and reports the leftover directory instead of throwing", async () => {
    const wt = undeletableWorktree("wt-locked", "kobe/locked")
    const seen: WorktreeResidue[] = []

    // Treating exit 255 as a plain `runGit` failure hands the caller a
    // GitCommandError for a removal git has already half-applied.
    await expect(manager.remove(wt, { force: true, onResidue: (r) => seen.push(r) })).resolves.toBeUndefined()

    expect(seen).toHaveLength(1)
    expect(seen[0].path).toBe(wt)
    // git's own words, not ours — a fabricated reason would not name the path.
    expect(seen[0].reason).toMatch(/Permission denied/)

    // The two halves really did split: git forgot it, the disk did not.
    expect(registered(wt)).toBe(false)
    expect(existsSync(wt)).toBe(true)
  })

  it("does NOT delete the leftover directory — it is reported, not cleaned up", async () => {
    const wt = undeletableWorktree("wt-keep", "kobe/keep")
    await manager.remove(wt, { force: true, onResidue: () => {} })
    // The whole point of reporting rather than cleaning: whatever made this
    // undeletable may be something the user wants.
    expect(existsSync(join(wt, "fixture", "keep.txt"))).toBe(true)
  })

  it("a second call converges instead of `is not a working tree`", async () => {
    const wt = undeletableWorktree("wt-retry", "kobe/retry")
    await manager.remove(wt, { force: true, onResidue: () => {} })

    const second: WorktreeResidue[] = []
    // Also red if the retry merely stops throwing: git cannot resolve this
    // path at all, so without the deregistered-dir probe the call answers
    // `is not a git worktree` and the caller has no forward move.
    await expect(manager.remove(wt, { force: true, onResidue: (r) => second.push(r) })).resolves.toBeUndefined()
    expect(second).toHaveLength(1)
    expect(second[0].path).toBe(wt)
  })

  it("still deletes the branch on the opt-in — the residue is not a live worktree", async () => {
    const wt = undeletableWorktree("wt-branch", "kobe/residue-branch")
    await manager.remove(wt, { force: true, deleteBranch: true, onResidue: () => {} })
    // The branch was undeletable only while checked out; the deregistration
    // released it, so skipping the delete on this path would silently leak it.
    const out = execSync('git branch --list "kobe/residue-branch"', { cwd: repo, env: gitEnv, encoding: "utf8" })
    expect(out.trim()).toBe("")
  })

  it("a residue under a managed root is never swept into the orphan rm -rf", async () => {
    // A deregistered worktree and an orphaned one look the SAME on disk — both
    // leave a dangling `gitdir:` pointer — and a Rove-managed residue also
    // satisfies the orphan branch's managed-root guard. So the residue check
    // must run FIRST. Move it after the orphan handling (or delete it) and a
    // forced delete `rm -rf`s the very directory git had just refused to
    // touch: the user's undeletable files, destroyed by the retry.
    const wt = join(managedRoot, "residue-in-root")
    execSync(`git worktree add -q ${JSON.stringify(wt)} -b kobe/residue-in-root`, { cwd: repo, env: gitEnv })
    const fixture = join(wt, "fixture")
    mkdirSync(fixture, { recursive: true })
    writeFileSync(join(fixture, "keep.txt"), "precious")
    chmodSync(fixture, 0o555)
    locked.push(fixture)

    await manager.remove(wt, { force: true, onResidue: () => {} })
    const second: WorktreeResidue[] = []
    await manager.remove(wt, { force: true, onResidue: (r) => second.push(r) })

    expect(second).toHaveLength(1)
    // The file git could not take is still there after BOTH calls.
    expect(existsSync(join(fixture, "keep.txt"))).toBe(true)
  })

  it("converges on a retry even where git unlinked the `.git` pointer first", async () => {
    // Platform split, found by CI: macOS git leaves the worktree's `.git`
    // pointer behind, Linux git unlinks it before failing. So the pointer
    // fingerprint is a fast path, not the guarantee — the guarantee is the
    // post-condition check ("is the directory still there?") after the
    // managed-root cleanup. Removing the pointer by hand reproduces the Linux
    // shape on any platform.
    const wt = join(managedRoot, "no-pointer")
    execSync(`git worktree add -q ${JSON.stringify(wt)} -b kobe/no-pointer`, { cwd: repo, env: gitEnv })
    const fixture = join(wt, "fixture")
    mkdirSync(fixture, { recursive: true })
    writeFileSync(join(fixture, "keep.txt"), "precious")
    chmodSync(fixture, 0o555)
    locked.push(fixture)

    await manager.remove(wt, { force: true, onResidue: () => {} })
    rmSync(join(wt, ".git"), { force: true })

    const second: WorktreeResidue[] = []
    await expect(manager.remove(wt, { force: true, onResidue: (r) => second.push(r) })).resolves.toBeUndefined()
    // Red if the orphan branch reports a clean removal: `rm -rf` exits 0
    // having deleted only what it could, so the caller would be told the
    // directory is gone while it is still on disk.
    expect(second).toHaveLength(1)
    expect(existsSync(join(fixture, "keep.txt"))).toBe(true)
  })

  it("a plain directory that was never a worktree still throws", async () => {
    // The classification must not swallow the real error: `onResidue` fires on
    // a DEREGISTERED worktree, never on any directory git doesn't know.
    const plain = join(root, "plain")
    mkdirSync(plain)
    await expect(manager.remove(plain, { onResidue: () => {} })).rejects.toThrow(/is not a git worktree/)
  })

  it("a clean removal reports no residue at all", async () => {
    const wt = join(root, "wt-clean")
    await manager.create(repo, "kobe/clean", wt)
    const seen: WorktreeResidue[] = []
    await manager.remove(wt, { onResidue: (r) => seen.push(r) })
    // Red if the probe fires unconditionally: every ordinary delete would
    // start telling the user about a directory that is gone.
    expect(seen).toEqual([])
    expect(existsSync(wt)).toBe(false)
  })
})

/**
 * The layout Rove actually creates on a remote project — the worktree lives
 * INSIDE its own repo (`<checkout>/.rove/worktrees/<slug>`, `paths.ts`), and
 * legacy repo-local roots put it there locally too.
 *
 * `rev-parse --git-common-dir` run from inside such a path walks up to the
 * parent repo and answers "yes, a repo" for a worktree git has already
 * forgotten, so the residue classification inverts and every removal throws.
 * The cases above all sit OUTSIDE the repo, which is why they never saw it.
 */
describe("remove() when the worktree is nested inside its own repo", () => {
  /** `<repo>/.rove/worktrees/<name>`, undeletable the same way. */
  function nestedUndeletableWorktree(name: string, branch: string): string {
    const wt = join(repo, ".rove", "worktrees", name)
    mkdirSync(join(repo, ".rove", "worktrees"), { recursive: true })
    execSync(`git worktree add -q ${JSON.stringify(wt)} -b ${branch}`, { cwd: repo, env: gitEnv })
    const fixture = join(wt, "fixture")
    mkdirSync(fixture, { recursive: true })
    writeFileSync(join(fixture, "keep.txt"), "x")
    chmodSync(fixture, 0o555)
    locked.push(fixture)
    return wt
  }

  it("reports the leftover directory instead of throwing", async () => {
    const wt = nestedUndeletableWorktree("wt-nested", "kobe/nested")
    const seen: WorktreeResidue[] = []

    // Red before the fix wherever git unlinks the `.git` pointer before
    // failing (Linux, i.e. every remote project): the post-failure probe then
    // resolves the PARENT repo, so the "still registered → nothing happened"
    // branch throws a GitCommandError for a removal git has already
    // half-applied, and the task is undeletable by any supported command.
    // macOS leaves the pointer dangling, which answers the probe by accident —
    // the retry case below is the platform-independent proof.
    await expect(manager.remove(wt, { force: true, onResidue: (r) => seen.push(r) })).resolves.toBeUndefined()

    expect(seen).toHaveLength(1)
    expect(seen[0].path).toBe(wt)
    expect(registered(wt)).toBe(false)
    expect(existsSync(wt)).toBe(true)
  })

  it("a second call converges even where git unlinked the `.git` pointer", async () => {
    const wt = nestedUndeletableWorktree("wt-nested-retry", "kobe/nested-retry")
    await manager.remove(wt, { force: true, onResidue: () => {} })
    // The Linux shape, reproduced on any platform: no pointer file left, so
    // the fingerprint fast path cannot fire and only the registration probe
    // can tell this from a live worktree.
    rmSync(join(wt, ".git"), { force: true })

    const second: WorktreeResidue[] = []
    await expect(manager.remove(wt, { force: true, onResidue: (r) => second.push(r) })).resolves.toBeUndefined()
    expect(second).toHaveLength(1)
    // Never swept into the orphan `rm -rf`: this directory is inside the
    // user's own checkout.
    expect(existsSync(join(wt, "fixture", "keep.txt"))).toBe(true)
  })

  it("prunes stale metadata when the directory itself is gone", async () => {
    // The vanished-directory branch probed the repo with `cwd` set to the
    // missing path, which cannot spawn, so `git worktree prune` never ran and
    // the stale `.git/worktrees/<name>/` registration survived — enough to
    // make a later `git worktree add` on that path fail.
    const wt = join(repo, ".rove", "worktrees", "wt-vanished")
    mkdirSync(join(repo, ".rove", "worktrees"), { recursive: true })
    execSync(`git worktree add -q ${JSON.stringify(wt)} -b kobe/vanished`, { cwd: repo, env: gitEnv })
    const adminDir = join(repo, ".git", "worktrees", "wt-vanished")
    expect(existsSync(adminDir)).toBe(true)

    rmSync(wt, { recursive: true, force: true })
    await manager.remove(wt)

    // The observable effect of the prune, not a spy on the argv: git dropped
    // the registration, so the path is re-addable.
    expect(existsSync(adminDir)).toBe(false)
    execSync(`git worktree add -q ${JSON.stringify(wt)} kobe/vanished`, { cwd: repo, env: gitEnv })
    expect(existsSync(wt)).toBe(true)
  })
})

/**
 * `remove()` when the worktree DIRECTORY is already gone (a user deleted it,
 * or a tool did).
 *
 * The removal here is nothing but a `git worktree prune` in the owning repo —
 * and that prune never ran. The repo was re-discovered by walking up from
 * `path.dirname(worktreePath)`, which for a real Rove worktree is
 * `~/.rove/worktrees/<key>`: inside no repository at all. So `remove()`
 * returned `removed` while git still listed the entry as `prunable`, `git
 * branch -D` failed forever with "used by worktree at <gone path>", and
 * `discover-adoptable` kept offering the ghost. The owning repo was known the
 * whole time — a task carries `task.repo`; it was simply never passed down.
 */
describe("remove() when the directory is already gone", () => {
  it("prunes the stale admin record using the repo the caller passed", async () => {
    const wt = join(managedRoot, "vanished")
    execSync(`git worktree add -q ${JSON.stringify(wt)} -b vanish`, { cwd: repo, env: gitEnv })
    rmSync(wt, { recursive: true, force: true })

    // The premise: nothing on disk can lead git back to the owning repo.
    expect(
      execSync("git rev-parse --git-common-dir 2>&1 || true", {
        cwd: join(managedRoot),
        env: gitEnv,
        encoding: "utf8",
        shell: "/bin/sh",
      }),
    ).toContain("not a git repository")

    await manager.remove(wt, { repo })

    expect(registered(wt)).toBe(false)
    // The user-visible consequence: the branch is usable again.
    execSync("git branch -D vanish", { cwd: repo, env: gitEnv })
  })

  it("still deletes the branch the caller asked to drop", async () => {
    // The branch to delete is normally read out of the worktree, and that
    // read needs the directory. With it gone `currentBranch` answered null,
    // so `deleteBranch: true` deleted nothing and `delete --delete-branch`
    // reported `removed` with the branch still sitting in `git branch`.
    const wt = join(managedRoot, "vanished-br")
    execSync(`git worktree add -q ${JSON.stringify(wt)} -b vanish-br`, { cwd: repo, env: gitEnv })
    rmSync(wt, { recursive: true, force: true })

    await manager.remove(wt, { repo, deleteBranch: true, branch: "vanish-br", force: true })

    const branches = execSync("git branch --format='%(refname:short)'", { cwd: repo, env: gitEnv, encoding: "utf8" })
    expect(branches.split("\n")).not.toContain("vanish-br")
  })

  it("without deleteBranch the branch survives, as it does everywhere else", async () => {
    const wt = join(managedRoot, "vanished-keep")
    execSync(`git worktree add -q ${JSON.stringify(wt)} -b keep-br`, { cwd: repo, env: gitEnv })
    rmSync(wt, { recursive: true, force: true })

    await manager.remove(wt, { repo, branch: "keep-br" })

    const branches = execSync("git branch --format='%(refname:short)'", { cwd: repo, env: gitEnv, encoding: "utf8" })
    expect(branches.split("\n")).toContain("keep-br")
  })
})

/**
 * The `opts.branch` FALLBACK on the live-directory path (`manager-remove.ts`,
 * the `?? opts.branch` in the pre-removal branch capture).
 *
 * The existing "still deletes the branch the caller asked to drop" case is
 * named for this line and never reaches it: it `rmSync`s the directory first,
 * so the missing-directory path consumes `opts.branch` and returns long
 * before. Deleting the fallback here left that test green.
 *
 * Its real trigger is a worktree that is present but has no branch name to
 * read: `currentBranch()` deliberately THROWS on detached HEAD rather than
 * hand back the literal `HEAD`, which is a state a hard reset produces. The
 * caller's recorded `task.branch` is then the only name left.
 */
describe("remove() when the worktree is on a detached HEAD", () => {
  it("falls back to the caller's branch name when HEAD cannot be read", async () => {
    const wt = join(managedRoot, "detached")
    execSync(`git worktree add -q ${JSON.stringify(wt)} -b detached-br`, { cwd: repo, env: gitEnv })
    execSync("git checkout -q --detach", { cwd: wt, env: gitEnv })
    // The premise: the worktree is still there, and git will not name a branch.
    expect(existsSync(wt)).toBe(true)
    expect(execSync("git rev-parse --abbrev-ref HEAD", { cwd: wt, env: gitEnv, encoding: "utf8" }).trim()).toBe("HEAD")

    await manager.remove(wt, { repo, deleteBranch: true, branch: "detached-br", force: true })

    const branches = execSync("git branch --format='%(refname:short)'", { cwd: repo, env: gitEnv, encoding: "utf8" })
    expect(branches.split("\n")).not.toContain("detached-br")
  })
})
