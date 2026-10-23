/**
 * Map a hook's `cwd` to a task. Global hooks (`rove hook <verb>`) fire for
 * every session and carry only the engine's directory; the match is the task
 * whose `worktreePath` is the cwd or its LONGEST prefix — worktrees live under
 * `~/.rove/worktrees/`, legacy `~/.rove/worktrees/`, or repo-local
 * `.rove/`/`.rove/`/`.claude/worktrees/`, and a `main` task's path is the repo
 * root, so the more specific one must win.
 *
 * A prefix alone isn't enough: a different repo nested under a tracked root
 * (a clone under `refs/`, a `.dev-sandbox` checkout, any repo under a `$HOME`
 * directory task) would be billed that task's badge, events, plugin dispatch
 * and tokens. See {@link crossesRepoBoundary}. No match → event dropped.
 */

import { existsSync } from "node:fs"
import path from "node:path"
import { pathIdentity as normalize, pathSyntax, pathWithin, samePath } from "../path-identity.ts"
import { managedWorktreeRootsFor, readWorktreeBaseOverride } from "./worktree-paths.ts"

export interface CwdMatchTask {
  readonly id: string
  readonly worktreePath?: string | null
  /** The task's repo root — names which repos rove already tracks. */
  readonly repo?: string | null
  /** Set on a child running in another task's directory; the directory's owner wins path ties. */
  readonly sharesWorkspaceOf?: string | null
  /** The parent-keyed hosted PTY that IS this task's conversation (migrated children). */
  readonly ptyAlias?: { readonly taskId: string; readonly tabId: string } | null
}

/** Rows on one path: the owner first, then sharers, each group by id — never list order. */
function ownerFirst(a: CwdMatchTask, b: CwdMatchTask): number {
  const rank = (t: CwdMatchTask) => (t.sharesWorkspaceOf ? 1 : 0)
  return rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * The task a report from hosted PTY `<taskId>::<tabId>` speaks for: a migrated
 * child aliased to that session, else the task itself. Env-derived identity
 * outranks any cwd guess.
 */
export function resolvePtyOwner(tasks: ReadonlyArray<CwdMatchTask>, taskId: string, tabId: string | undefined): string {
  if (!tabId) return taskId
  const aliased = tasks.find((t) => t.ptyAlias?.taskId === taskId && t.ptyAlias.tabId === tabId)
  return aliased?.id ?? taskId
}

/**
 * True when a directory strictly below `wt`, down to and including `cwd`, is
 * its own repo root. Bare existence check: `.git` is a dir for a clone and a
 * file for a submodule or linked worktree; either way `git rev-parse
 * --show-toplevel` in `cwd` isn't the task's worktree. `wt` itself is never
 * tested — it IS a repo root and would reject every match.
 */
function crossesRepoBoundary(wt: string, cwd: string): boolean {
  const syntax = pathSyntax(cwd)
  for (let dir = cwd; !samePath(dir, wt); dir = syntax.dirname(dir)) {
    if (existsSync(syntax.join(dir, ".git"))) return true
    if (samePath(dir, syntax.dirname(dir))) break
  }
  return false
}

/**
 * Longest worktree containing `cwd`, or undefined. Only the winner is
 * boundary-checked: a boundary below it is below every shorter candidate too.
 */
export function matchTaskByCwd(tasks: ReadonlyArray<CwdMatchTask>, cwd: string): string | undefined {
  const target = normalize(cwd)
  let best: CwdMatchTask | undefined
  let bestWt = ""
  for (const t of tasks) {
    if (!t.worktreePath) continue
    const wt = normalize(t.worktreePath)
    if (pathWithin(wt, target) === null) continue
    // Longest worktree wins; on a tie (an owner and its sharers) the owner.
    if (!best || wt.length > bestWt.length || (wt.length === bestWt.length && ownerFirst(t, best) < 0)) {
      best = t
      bestWt = wt
    }
  }
  if (best && crossesRepoBoundary(bestWt, target)) return undefined
  return best?.id
}

/**
 * Every task whose worktree is exactly `worktreePath`, owner first. Unlike
 * {@link matchTaskByCwd}, an untracked worktree must not match the parent
 * `main` task (repo root). Sharers of one directory all match.
 */
export function tasksAtWorktreePath(tasks: ReadonlyArray<CwdMatchTask>, worktreePath: string): string[] {
  const target = normalize(worktreePath)
  return tasks
    .filter((t) => t.worktreePath && normalize(t.worktreePath) === target)
    .sort(ownerFirst)
    .map((t) => t.id)
}

/**
 * A `cwd` that is an unadopted worktree under a tracked repo's managed roots
 * (`~/.rove/worktrees/<repo-key>` or a legacy repo-local root); the daemon
 * adopts it on `session-start`. Pure, git-free, bounded to known repos; the
 * caller's `adoptWorktree` is git-validated, so a non-worktree that slips
 * through is rejected there.
 */
export function findAdoptableWorktree(
  tasks: ReadonlyArray<CwdMatchTask>,
  cwd: string,
): { repo: string; worktreePath: string } | undefined {
  const target = normalize(cwd)
  const repos = new Set<string>()
  const known = new Set<string>()
  for (const t of tasks) {
    // A remote repo key (`ssh://…`) has no local root, and
    // `managedWorktreeRootsFor` throws on it — one remote project must not
    // reject the whole handler.
    if (t.repo && path.isAbsolute(t.repo)) repos.add(normalize(t.repo))
    if (t.worktreePath) known.add(normalize(t.worktreePath))
  }
  for (const repo of repos) {
    // Per repo: `$project_dir` in the override expands against THIS repo.
    for (const root of managedWorktreeRootsFor(repo, readWorktreeBaseOverride(repo)).map(normalize)) {
      const prefix = root.endsWith("/") ? root : `${root}/`
      const rest = pathWithin(root, target)
      if (!rest) continue
      // First path segment after the managed root is the worktree dir.
      const name = rest.split("/")[0]
      if (!name) continue
      const worktreePath = `${prefix}${name}`
      if (known.has(worktreePath)) return undefined // already a task → nothing to adopt
      return { repo, worktreePath }
    }
  }
  return undefined
}
