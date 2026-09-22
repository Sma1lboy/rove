/**
 * Map a hook's `cwd` to a task. Global hooks (`kobe hook <verb>`) fire for
 * every session and carry only the engine's directory; the match is the task
 * whose `worktreePath` is the cwd or its LONGEST prefix — worktrees live under
 * `~/.rove/worktrees/`, legacy `~/.kobe/worktrees/`, or repo-local
 * `.rove/`/`.kobe/`/`.claude/worktrees/`, and a `main` task's path is the repo
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
  /** The task's repo root — names which repos kobe already tracks. */
  readonly repo?: string | null
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
  let bestId: string | undefined
  let bestWt = ""
  let bestLen = -1
  for (const t of tasks) {
    if (!t.worktreePath) continue
    const wt = normalize(t.worktreePath)
    if (pathWithin(wt, target) !== null && wt.length > bestLen) {
      bestLen = wt.length
      bestWt = wt
      bestId = t.id
    }
  }
  if (bestId && crossesRepoBoundary(bestWt, target)) return undefined
  return bestId
}

/**
 * Task whose worktree is exactly `worktreePath`, for `worktree.remove`. Unlike
 * {@link matchTaskByCwd}, removing an untracked worktree must not match the
 * parent `main` task (repo root). Worktree paths are unique, so ≤1 match.
 */
export function matchTaskByWorktreePath(tasks: ReadonlyArray<CwdMatchTask>, worktreePath: string): string | undefined {
  const target = normalize(worktreePath)
  for (const t of tasks) {
    if (t.worktreePath && normalize(t.worktreePath) === target) return t.id
  }
  return undefined
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
