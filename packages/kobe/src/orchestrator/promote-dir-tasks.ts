/**
 * Promote a `dir` task that is sitting on a repository root into that repo's
 * `main` row.
 *
 * `rove .` already routes a repo root to `ensureMainTask` (open-dir-cmd.ts),
 * so nothing NEW lands as a mis-shaped row. What has no owner is a row
 * already on disk: a `dir` task pinned to a git toplevel, rendering
 * under its own path as though the directory were not a project, and outside
 * every rule written for `main` — the sidebar's project ordering, the pin, the
 * fold. `MainTaskCoordinator.ensure` already knows how to absorb such a row
 * (its `adoptable` branch keeps the task id, so terminal tabs move with it);
 * this is the sweep that finds them, since `ensure` only runs when somebody
 * names the repo.
 *
 * Its own module because the two halves answer different questions and fail
 * differently: WHICH rows qualify is a pure decision over the task list, and
 * DOING the promotion is `MainTaskCoordinator`'s existing job. Keeping the
 * decision here lets every exclusion below be tested without a git repo —
 * `isRepoRoot` is injected — and each of them is a row that LOOKS promotable
 * and must not be.
 */

import type { Task } from "../types/task.ts"

/** A task list plus the question this sweep needs answered about paths. */
export interface PromotableDeps {
  readonly tasks: readonly Task[]
  /** True when `path` is the toplevel of a git repository. */
  readonly isRepoRoot: (path: string) => boolean
}

/**
 * The repo roots that a `dir` task occupies and no `main` row claims yet.
 *
 * Excludes:
 *   - **scratch** rows — their cwd is unsettled by definition, and
 *     a scratch shell that happens to start inside a repo is still a scratch
 *     shell, not that repo's project row;
 *   - roots that ALREADY have a main row — promoting there would mint a
 *     second row for one checkout, which is the duplicate `ensure` exists to
 *     prevent;
 *   - a `dir` task pinned to a SUBDIRECTORY of a repo. Opening
 *     `my-monorepo/packages/app` is a deliberate choice of that directory;
 *     promoting it would silently re-target the whole monorepo, which is the
 *     "ghost project named after a subdirectory" `open-dir-cmd` refuses to
 *     create in the first place.
 */
export function promotableDirTasks(deps: PromotableDeps): readonly Task[] {
  const claimed = new Set(deps.tasks.filter((task) => task.kind === "main").map((task) => task.repo))
  const seen = new Set<string>()
  const out: Task[] = []
  for (const task of deps.tasks) {
    if (task.kind !== "dir" || task.scratch === true) continue
    // A dir task's `repo` IS the directory it pins (openDirectoryTask), so
    // this asks "is the thing you opened a repo root", not "is it inside one".
    const path = task.repo
    if (!path || claimed.has(path) || seen.has(path)) continue
    if (!deps.isRepoRoot(path)) continue
    seen.add(path)
    out.push(task)
  }
  return out
}
