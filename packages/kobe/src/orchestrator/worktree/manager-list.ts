/** `manager.ts`'s read-only LISTING half: nothing here can change the repo;
 *  a bug is a wrong answer, not a lost worktree. */

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

export interface ListDeps {
  ctxFor(repoKey: string): ExecCtx
  runGitStdout(ctx: ExecCtx, args: readonly string[]): Promise<string>
  /** Read-only git at a worktree cwd (last-activity probe). */
  runGitStdoutAt(ctx: ExecCtx, cwd: string, args: readonly string[]): Promise<string>
  isDirty(worktreePath: string): Promise<boolean>
}

/** Epoch ms: HEAD committer time, else directory mtime (unborn branch), else 0
 *  so the adopt list still sorts. */
async function lastActivityMs(deps: ListDeps, ctx: ExecCtx, worktreePath: string): Promise<number> {
  try {
    const stdout = await deps.runGitStdoutAt(ctx, worktreePath, ["log", "-1", "--format=%ct"])
    const secs = Number.parseInt(stdout.trim(), 10)
    if (Number.isFinite(secs) && secs > 0) return secs * 1000
  } catch {
    // no commits yet / not readable — fall through to mtime
  }
  // Local only; a remote miss sorts as 0.
  if (!ctx.exec.isRemote) {
    try {
      return fs.statSync(worktreePath).mtimeMs
    } catch {
      // unreadable — fall through to 0
    }
  }
  return 0
}

/** Local + `origin` (prefix stripped, `HEAD` dropped): style inference and
 *  taken-set for `branch-style.ts`. Broken/unborn repo → `[]` ("no convention"). */
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

  // Filter first, then probe dirty concurrently (bounded): each probe is a git
  // status / ssh round-trip.
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
    // Re-root into the caller's form (git reports `/private/var/...` for
    // `/var/...`) so `path.startsWith(callerRoot)` holds. Legacy paths stay
    // under the legacy root.
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
    // Catch: one vanished worktree must not fail the whole list (sidebar goes
    // dark). But `null` (unknown), never `false`: "clean" reads as safe to
    // delete for a tree `git status` couldn't read.
    dirty: await deps.isDirty(e.probePath).catch(() => null),
  }))
}

export async function listAllAdoptable(deps: ListDeps, repo: string): Promise<readonly AdoptableWorktree[]> {
  const ctx = deps.ctxFor(repo)
  const adoptable = await adoptablePaths(deps, ctx)
  // Two git spawns / ssh round-trips each: bounded concurrency.
  const infos = await mapWithLimit(adoptable, PROBE_CONCURRENCY, async (entry) => {
    const [dirty, activityMs] = await Promise.all([
      // Unknown is `null`, not clean.
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

/** Non-bare, on a branch, not the primary checkout nor the caller's own. No
 *  per-worktree probes (callers add them or skip them). */
export async function adoptablePaths(
  deps: ListDeps,
  ctx: ExecCtx,
): Promise<{ readonly path: string; readonly branch: string; readonly head: string }[]> {
  requireAbsolute("repo", ctx.dir)
  const all = parseWorktreeListPorcelain(await deps.runGitStdout(ctx, ["worktree", "list", "--porcelain"]))
  const canon = (p: string): string => (ctx.remote ? p : canonicalize(p))
  const canonRepo = canon(ctx.dir)
  // The PRIMARY checkout is git's first entry, not `ctx.dir` (which may be a
  // linked worktree). Otherwise `adopt` would record the user's primary
  // checkout as a disposable managed task.
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
    // Never the caller's own worktree.
    if (canonEntry === canonRepo) continue
    kept.push({ path: entry.path, branch: entry.branch, head: entry.head ?? "" })
  }
  return kept
}

/**
 * Admin-dir names under `<git-common-dir>/worktrees/` that `worktree list
 * --porcelain` omitted: git skips an unreadable admin dir and still exits 0,
 * so {@link adoptablePaths} alone reads it as "nothing to adopt" while work
 * sits on disk. NAMES ONLY: the unreadable `gitdir` is the only record of the
 * path, and a fabricated path is one `adopt` would use. Diagnostic, never a
 * gate: any enumeration failure returns `[]`.
 */
export async function unreadableWorktreeNames(deps: ListDeps, ctx: ExecCtx): Promise<readonly string[]> {
  // A remote repo's admin dirs are not on this filesystem.
  if (ctx.remote) return []
  requireAbsolute("repo", ctx.dir)
  let adminRoot: string
  try {
    // Relative to git's cwd (usually `.git`).
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
    // Match the RESOLVED path: git dedupes colliding admin names (`foo`,
    // `foo1`), so names would flag a healthy second `foo`.
    if (gitdir && !reported.has(canonicalize(path.dirname(gitdir)))) missing.push(name)
  }
  return missing
}
