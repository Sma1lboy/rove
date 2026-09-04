/**
 * The worktree LISTING operations of `manager.ts` — the read-only half, which
 * is why they are safe to hold apart from create/remove: nothing here can
 * change the repo, and a bug is a wrong answer rather than a lost worktree.
 *
 * `listManaged` / `listAllAdoptable` / `adoptablePaths` are the porcelain-parse
 * + filter + concurrent-probe logic behind `GitWorktreeManager.list` /
 * `.listAll` / `.listAdoptablePaths`. They're free functions taking a small
 * {@link ListDeps} (the ctx + the git/probe primitives the manager already
 * owns) so the class methods stay thin delegators — no behaviour change.
 */

import fs from "node:fs"
import path from "node:path"
import type { AdoptableWorktree, WorktreeInfo } from "../../types/worktree.ts"
import { PROBE_CONCURRENCY, mapWithLimit } from "./concurrency.ts"
import type { ExecCtx } from "./exec-deps.ts"
import {
  canonicalize,
  isKobeManagedPath,
  managedWorktreeRootForPath,
  remoteManagedRootForPath,
  requireAbsolute,
} from "./paths.ts"
import { parseWorktreeListPorcelain } from "./worktree-list.ts"

/** The manager primitives the listing functions borrow. */
export interface ListDeps {
  ctxFor(repoKey: string): ExecCtx
  runGitStdout(ctx: ExecCtx, args: readonly string[]): Promise<string>
  /** Read-only git at an arbitrary (worktree) cwd — the last-activity probe. */
  runGitStdoutAt(ctx: ExecCtx, cwd: string, args: readonly string[]): Promise<string>
  isDirty(worktreePath: string): Promise<boolean>
}

/**
 * Last-activity time of a worktree in epoch ms — the HEAD commit's
 * committer time, falling back to the directory's mtime when the log
 * read fails (e.g. an unborn branch). Best-effort: returns 0 on total
 * failure so sorting still works. Used to order the adopt list.
 */
async function lastActivityMs(deps: ListDeps, ctx: ExecCtx, worktreePath: string): Promise<number> {
  try {
    const stdout = await deps.runGitStdoutAt(ctx, worktreePath, ["log", "-1", "--format=%ct"])
    const secs = Number.parseInt(stdout.trim(), 10)
    if (Number.isFinite(secs) && secs > 0) return secs * 1000
  } catch {
    // no commits yet / not readable — fall through to mtime
  }
  // mtime fallback is a local-only convenience; on a remote the git-log
  // path above is the source of truth and a miss simply sorts as 0.
  if (!ctx.exec.isRemote) {
    try {
      return fs.statSync(worktreePath).mtimeMs
    } catch {
      // unreadable — fall through to 0
    }
  }
  return 0
}

/**
 * Branch names of `repo` — local plus `origin`, with the `origin/` prefix
 * stripped and `HEAD` dropped. The raw material for repo-convention branch
 * naming (`branch-style.ts`): both the style inference and the taken-set
 * for uniqueness. Best-effort — an unborn/broken repo yields `[]`, which
 * the naming layer reads as "no convention".
 */
export async function listBranchNames(deps: ListDeps, repo: string): Promise<readonly string[]> {
  const ctx = deps.ctxFor(repo)
  requireAbsolute("repo", ctx.dir)
  let stdout: string
  try {
    stdout = await deps.runGitStdout(ctx, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes/origin",
    ])
  } catch {
    return []
  }
  const names = new Set<string>()
  for (const line of stdout.split("\n")) {
    const name = line.trim().replace(/^origin\//, "")
    if (name && name !== "HEAD") names.add(name)
  }
  return [...names]
}

/** kobe-managed worktrees under `repo` — see `GitWorktreeManager.list`. */
export async function listManaged(deps: ListDeps, repo: string): Promise<readonly WorktreeInfo[]> {
  const ctx = deps.ctxFor(repo)
  requireAbsolute("repo", ctx.dir)
  const all = parseWorktreeListPorcelain(await deps.runGitStdout(ctx, ["worktree", "list", "--porcelain"]))

  // Filter + re-root synchronously first, then probe every survivor's dirty
  // state concurrently (bounded) — the probes are the slow part (a git status /
  // ssh round-trip each), so they must not run one-at-a-time.
  const kept: {
    readonly callerPath: string
    readonly probePath: string
    readonly branch: string
    readonly head: string
  }[] = []
  for (const entry of all) {
    if (!entry.path) continue
    // Remote: Rove-managed = canonical or legacy remote roots. Local: the
    // `~/.rove/worktrees/<repo-key>` root plus compatibility roots.
    const callerRoot = ctx.remote
      ? remoteManagedRootForPath(ctx.dir, entry.path)
      : managedWorktreeRootForPath(repo, entry.path)
    if (!callerRoot) continue
    // Detached / bare entries don't have a branch we care about.
    if (!entry.branch || entry.detached) continue
    // Re-root paths into the caller's form. Git on macOS reports
    // `/private/var/...` but the caller passed in `/var/...`; we hand back paths
    // that satisfy `path.startsWith(callerRoot)` so callers can use string ops
    // without surprise. Legacy paths stay under the legacy root instead of being
    // rewritten to the primary root.
    const rel = path.relative(canonicalize(callerRoot), canonicalize(entry.path))
    kept.push({
      callerPath: path.join(callerRoot, rel),
      probePath: entry.path,
      branch: entry.branch,
      head: entry.head ?? "",
    })
  }
  return mapWithLimit(kept, PROBE_CONCURRENCY, async (e) => ({
    path: e.callerPath,
    branch: e.branch,
    head: e.head,
    // A worktree can vanish between the porcelain snapshot and this probe, and
    // an unguarded throw here fails the WHOLE list — the entire sidebar goes
    // dark over one stale row. So the catch stays; what changed is its VALUE:
    // `null` (unknown), never `false`. A worktree whose `git status` answers
    // "Permission denied" holds whatever it held, and listing it as clean is
    // the one answer that reads as safe to delete.
    dirty: await deps.isDirty(e.probePath).catch(() => null),
  }))
}

/** ALL adoptable worktrees under `repo` (probed) — see `GitWorktreeManager.listAll`. */
export async function listAllAdoptable(deps: ListDeps, repo: string): Promise<readonly AdoptableWorktree[]> {
  const ctx = deps.ctxFor(repo)
  const adoptable = await adoptablePaths(deps, ctx)
  // Probe dirty + last-activity for every survivor concurrently (bounded) — two
  // git spawns / ssh round-trips each, the slow part of this call.
  const infos = await mapWithLimit(adoptable, PROBE_CONCURRENCY, async (entry) => {
    const [dirty, activityMs] = await Promise.all([
      // Same as the sibling probe above: unknown is `null`, not clean.
      deps
        .isDirty(entry.path)
        .catch(() => null),
      lastActivityMs(deps, ctx, entry.path),
    ])
    return {
      path: entry.path,
      branch: entry.branch,
      head: entry.head,
      dirty,
      kobeManaged: ctx.remote
        ? remoteManagedRootForPath(ctx.dir, entry.path) !== null
        : isKobeManagedPath(repo, entry.path),
      lastActivityMs: activityMs,
    }
  })
  // Most recently active first.
  infos.sort((a, b) => b.lastActivityMs - a.lastActivityMs)
  return infos
}

/**
 * The bare/detached/main-checkout filter shared by {@link listAllAdoptable} and
 * `GitWorktreeManager.listAdoptablePaths`: keep only entries that are adoption
 * candidates (a real, non-bare, branch-checked-out worktree that isn't the
 * repo's own main checkout). No per-worktree probes — the cheap part callers
 * layer probes onto (or, for a path match, skip entirely).
 */
export async function adoptablePaths(
  deps: ListDeps,
  ctx: ExecCtx,
): Promise<{ readonly path: string; readonly branch: string; readonly head: string }[]> {
  requireAbsolute("repo", ctx.dir)
  const all = parseWorktreeListPorcelain(await deps.runGitStdout(ctx, ["worktree", "list", "--porcelain"]))
  const canon = (p: string): string => (ctx.remote ? p : canonicalize(p))
  const canonRepo = canon(ctx.dir)
  // The repository's PRIMARY checkout, which git always lists first — not
  // `ctx.dir`. Called with a linked worktree, `ctx.dir` is that worktree, so
  // comparing against it alone excluded the caller and left the user's own
  // primary checkout in the adoptable list: `discover-adoptable` offered it
  // and `adopt` (which validates through this same function) recorded it as a
  // disposable managed task on the default branch, which `rove add <linked
  // worktree>` then did unprompted.
  const canonMain = all.find((entry) => entry.path)?.path
  const canonMainPath = canonMain ? canon(canonMain) : null
  const kept: { readonly path: string; readonly branch: string; readonly head: string }[] = []
  for (const entry of all) {
    if (!entry.path) continue
    if (entry.bare) continue
    // Detached entries have no branch to map to a task's branch.
    if (!entry.branch || entry.detached) continue
    const canonEntry = canon(entry.path)
    // Skip the repo's main checkout — it is the project row, never a task.
    if (canonMainPath !== null && canonEntry === canonMainPath) continue
    // Skip the caller's own worktree: adopting the worktree you are asking
    // from is never the answer.
    if (canonEntry === canonRepo) continue
    kept.push({ path: entry.path, branch: entry.branch, head: entry.head ?? "" })
  }
  return kept
}

/**
 * Worktree admin-dir names under `<git-common-dir>/worktrees/` that
 * `git worktree list --porcelain` did NOT report.
 *
 * Git omits an entry whose admin dir it cannot read AND still exits 0, so
 * without this cross-check {@link adoptablePaths} answers `[]` for a repo
 * whose worktree is merely unreadable — a result indistinguishable from
 * "nothing to adopt", while the directory and its uncommitted work sit
 * untouched on disk and the user has no path to adopt it.
 *
 * NAMES ONLY, on purpose: with the admin dir unreadable its `gitdir` file —
 * the one record of where that worktree lives — is unreadable too, so there
 * is no path, branch, or head to report. Inventing one would be a second lie,
 * and a fabricated path is a path `adopt` would try to use.
 *
 * Diagnostic augmentation, never a gate: any failure to enumerate returns
 * `[]`, which leaves the caller exactly where it stood before this existed.
 */
export async function unreadableWorktreeNames(deps: ListDeps, ctx: ExecCtx): Promise<readonly string[]> {
  // A remote repo's admin dirs are not on this filesystem.
  if (ctx.remote) return []
  requireAbsolute("repo", ctx.dir)
  let adminRoot: string
  try {
    // `--git-common-dir` is relative to the cwd git ran in (usually `.git`),
    // so resolve it against that cwd rather than assuming an absolute answer.
    const common = (await deps.runGitStdout(ctx, ["rev-parse", "--git-common-dir"])).trim()
    if (!common) return []
    adminRoot = path.join(path.resolve(ctx.dir, common), "worktrees")
  } catch {
    return []
  }
  let names: string[]
  try {
    names = fs
      .readdirSync(adminRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return [] // no worktrees dir at all — a repo that never had one
  }
  if (names.length === 0) return []
  let listed: string
  try {
    listed = await deps.runGitStdout(ctx, ["worktree", "list", "--porcelain"])
  } catch {
    return []
  }
  const reported = new Set(
    parseWorktreeListPorcelain(listed)
      .filter((entry) => entry.path)
      .map((entry) => canonicalize(entry.path as string)),
  )
  const missing: string[] = []
  for (const name of names) {
    let gitdir: string
    try {
      // "<worktree>/.git" — the admin dir's own pointer back at the checkout.
      gitdir = fs.readFileSync(path.join(adminRoot, name, "gitdir"), "utf8").trim()
    } catch {
      // Cannot read its own record, which is exactly why git skipped it.
      missing.push(name)
      continue
    }
    // Matching on the RESOLVED path, not the admin name: git de-duplicates
    // colliding basenames (`foo`, `foo1`), so a name comparison would flag a
    // perfectly healthy second `foo` as missing.
    if (gitdir && !reported.has(canonicalize(path.dirname(gitdir)))) missing.push(name)
  }
  return missing
}
