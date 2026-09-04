/**
 * Map a hook's reported `cwd` to a kobe task (KOB).
 *
 * Global activity hooks (`kobe hook <verb>`) fire for EVERY Claude session and
 * carry no task id — only the directory the engine runs in. The daemon resolves
 * that to a task by worktree path here. A task's worktree is the engine's cwd
 * (or an ancestor of it, if the engine cd'd into a subdir), so we take the task
 * whose `worktreePath` is the cwd or the LONGEST path-prefix of it.
 *
 * Longest-prefix matters because managed worktrees may live under canonical
 * global `~/.rove/worktrees/`, legacy global `~/.kobe/worktrees/`, or repo-local
 * `.rove/worktrees/`, `.kobe/worktrees/`, and `.claude/worktrees/` roots. A
 * `main` task's worktreePath can be the repo root itself, so the more specific
 * (longer) worktree must win.
 *
 * A prefix match alone is NOT enough: the hooks are global, so a session in a
 * DIFFERENT repository nested under a tracked project's root (a vendored
 * clone under `refs/`, a `.dev-sandbox` checkout, any repo under a `$HOME`
 * scratch shell's directory task) prefix-matches that project and would be
 * billed its badge, its events, its plugin dispatch and its tokens. So a
 * candidate is rejected when a repository boundary sits between the task's
 * worktree and the cwd — see {@link crossesRepoBoundary}.
 *
 * cwds that match no task (an unrelated repo, a project root with no main task)
 * return undefined → the event is dropped.
 */

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { LEGACY_KOBE_STATE_DIR_BASENAME, ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"

const KOBE_WORKTREE_ROOT_DIR = "worktrees"
const REPO_LOCAL_ROVE_WORKTREE_ROOT_SUBPATH = ".rove/worktrees"
const REPO_LOCAL_KOBE_WORKTREE_ROOT_SUBPATH = ".kobe/worktrees"
const LEGACY_KOBE_WORKTREE_ROOT_SUBPATH = ".claude/worktrees"
const REPO_LOCAL_KOBE_MANAGED_WORKTREE_ROOT_SUBPATHS = [
  REPO_LOCAL_ROVE_WORKTREE_ROOT_SUBPATH,
  REPO_LOCAL_KOBE_WORKTREE_ROOT_SUBPATH,
  LEGACY_KOBE_WORKTREE_ROOT_SUBPATH,
] as const

function stateDir(basename: string): string {
  return path.join(readRoveHomeDirEnv() ?? homedir(), basename)
}

function repoWorktreeDirName(repo: string): string {
  const base = path.basename(repo) || "repo"
  const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo"
  const hash = createHash("sha1").update(path.resolve(repo)).digest("hex").slice(0, 12)
  return `${safeBase}-${hash}`
}

function worktreeRootFor(repo: string): string {
  if (!path.isAbsolute(repo)) {
    throw new Error(`worktreeRootFor: repo must be an absolute path, got: ${repo}`)
  }
  return path.join(stateDir(ROVE_STATE_DIR_BASENAME), KOBE_WORKTREE_ROOT_DIR, repoWorktreeDirName(repo))
}

function managedWorktreeRootsFor(repo: string): readonly string[] {
  if (!path.isAbsolute(repo)) {
    throw new Error(`managedWorktreeRootsFor: repo must be an absolute path, got: ${repo}`)
  }
  return [
    worktreeRootFor(repo),
    path.join(stateDir(LEGACY_KOBE_STATE_DIR_BASENAME), KOBE_WORKTREE_ROOT_DIR, repoWorktreeDirName(repo)),
    ...REPO_LOCAL_KOBE_MANAGED_WORKTREE_ROOT_SUBPATHS.map((subpath) => path.join(repo, subpath)),
  ]
}

export interface CwdMatchTask {
  readonly id: string
  readonly worktreePath?: string | null
  /** The task's repo root — names which repos kobe already tracks. */
  readonly repo?: string | null
}

/** Strip a single trailing slash (but keep a bare root "/"). */
function normalize(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p
}

/** True if `wt` is `cwd` itself or a path-segment ancestor of it. */
function isAncestorOrSelf(wt: string, cwd: string): boolean {
  return cwd === wt || cwd.startsWith(`${wt}/`)
}

/**
 * True when some directory strictly below `wt`, down to and including `cwd`,
 * is a git repository root of its own — i.e. walking up from the engine's cwd
 * to the task's worktree crosses out of one repository into another.
 *
 * `.git` is tested with a bare existence check because both spellings mean the
 * same thing here: a directory for a normal clone, a file for a submodule or a
 * linked worktree. Either way `git rev-parse --show-toplevel` in `cwd` would
 * answer something other than the task's worktree, so the engine is not
 * working on that task's code.
 *
 * `wt` itself is deliberately never tested — a task's own worktree IS a repo
 * root (or a linked worktree with a `.git` file), and testing it would reject
 * every legitimate match.
 */
function crossesRepoBoundary(wt: string, cwd: string): boolean {
  for (let dir = cwd; dir.length > wt.length; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".git"))) return true
  }
  return false
}

/**
 * Return the id of the task whose worktree contains `cwd`, preferring the
 * longest (most specific) worktree path, or undefined if none match or the
 * best match is in a different repository than `cwd`.
 *
 * Only the winner is boundary-checked: a boundary below the longest candidate
 * is below every shorter one too, so if the most specific match crosses, so
 * does every alternative.
 */
export function matchTaskByCwd(tasks: ReadonlyArray<CwdMatchTask>, cwd: string): string | undefined {
  const target = normalize(cwd)
  let bestId: string | undefined
  let bestWt = ""
  let bestLen = -1
  for (const t of tasks) {
    if (!t.worktreePath) continue
    const wt = normalize(t.worktreePath)
    if (isAncestorOrSelf(wt, target) && wt.length > bestLen) {
      bestLen = wt.length
      bestWt = wt
      bestId = t.id
    }
  }
  if (bestId && crossesRepoBoundary(bestWt, target)) return undefined
  return bestId
}

/**
 * Return the id of the task whose worktree IS exactly `worktreePath` (not just
 * an ancestor of it), or undefined if none match.
 *
 * Used by `worktree.remove`: find the task whose
 * worktreePath IS exactly `worktreePath` (not just an ancestor). Exactness
 * matters — unlike {@link matchTaskByCwd}'s longest-prefix match, removing an
 * UNTRACKED worktree must not match a parent `main` task (whose worktreePath is
 * the repo root and would prefix-match a child path). The first exact match wins;
 * task worktree paths are unique, so there is at most one.
 */
export function matchTaskByWorktreePath(tasks: ReadonlyArray<CwdMatchTask>, worktreePath: string): string | undefined {
  const target = normalize(worktreePath)
  for (const t of tasks) {
    if (t.worktreePath && normalize(t.worktreePath) === target) return t.id
  }
  return undefined
}

/**
 * Detect a `cwd` that is an UNADOPTED git worktree under a tracked repo's
 * managed worktree roots — the replacement for the removed WorktreeCreate
 * hook. When an engine starts in a worktree under `~/.rove/worktrees/<repo-key>`
 * or a legacy repo-local root for a repo Rove already has tasks in, the daemon
 * adopts it as a task on the engine's `session-start`.
 *
 * Pure + git-free (string paths only, bounded to known repos): returns the
 * `{ repo, worktreePath }` to adopt, or undefined when `cwd` isn't under any
 * tracked repo's worktrees dir or that worktree is already a task. The caller
 * still calls `adoptWorktree` (idempotent + git-validated), so a non-worktree
 * directory that slips through is rejected there.
 */
export function findAdoptableWorktree(
  tasks: ReadonlyArray<CwdMatchTask>,
  cwd: string,
): { repo: string; worktreePath: string } | undefined {
  const target = normalize(cwd)
  const repos = new Set<string>()
  const known = new Set<string>()
  for (const t of tasks) {
    // A remote-project repo key (`ssh://…`) is not an absolute path and has no
    // local managed worktree root, so it can never host an adoptable on-disk
    // worktree — and feeding it to `managedWorktreeRootsFor` below throws.
    // Skip it: a single remote project must not reject the whole event handler.
    if (t.repo && path.isAbsolute(t.repo)) repos.add(normalize(t.repo))
    if (t.worktreePath) known.add(normalize(t.worktreePath))
  }
  for (const repo of repos) {
    for (const root of managedWorktreeRootsFor(repo).map(normalize)) {
      const prefix = `${root}/`
      if (!target.startsWith(prefix)) continue
      // First path segment after the managed root is the worktree dir.
      const rest = target.slice(prefix.length)
      const name = rest.split("/")[0]
      if (!name) continue
      const worktreePath = `${prefix}${name}`
      if (known.has(worktreePath)) return undefined // already a task → nothing to adopt
      return { repo, worktreePath }
    }
  }
  return undefined
}
