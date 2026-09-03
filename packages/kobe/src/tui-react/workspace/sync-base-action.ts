/**
 * Sync a task's worktree with its base — the row menu's "Sync with base", and
 * the action behind the sidebar's `↓N` drift chip.
 *
 * Its own module for the same reason as `land-task-action.ts`, and shaped
 * deliberately like it: the two outcomes a human has to act on (a merge
 * conflict, a worktree too dirty to merge into) come back from the daemon as
 * MARKERS inside the error message rather than as failures, so they get the
 * attention tone and a message naming the files, while anything else is a real
 * error. React-free so it can be unit-tested.
 *
 * No confirm dialog, unlike landing: a merge from the base is additive and
 * `git merge --abort` undoes it, whereas landing rewrites the base branch and
 * removes the worktree.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

const CONFLICT_RE = /SYNC_CONFLICT(?:: )?(.*)/
const DIRTY_RE = /SYNC_WORKTREE_DIRTY/

export interface SyncBaseDeps {
  readonly orchestrator: Pick<RemoteOrchestrator, "syncBase">
  readonly notifyInfo: (message: string) => void
  /** Attention tone (yellow): nothing broke, but a human is needed next. */
  readonly notifyNeedsInput: (message: string) => void
  readonly notifyError: (message: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
}

/**
 * Run one sync. Resolves true when the worktree ends up current (including
 * "it already was"), false on a conflict, a refusal, or a failure — each of
 * which has already been reported through the notifiers.
 */
export async function syncBaseAction(deps: SyncBaseDeps, taskId: string): Promise<boolean> {
  const { t } = deps
  try {
    const res = await deps.orchestrator.syncBase(taskId)
    deps.notifyInfo(
      res.alreadyCurrent
        ? t("tasks.sync.alreadyCurrent", { base: res.baseRef })
        : t("tasks.sync.done", { base: res.baseRef }),
    )
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const conflict = CONFLICT_RE.exec(msg)
    // The merge is left IN PLACE on a conflict — the conflicted files are what
    // the user (or their engine) is about to resolve, so name them.
    if (conflict) deps.notifyNeedsInput(t("tasks.sync.conflict", { files: conflict[1]?.trim() || "?" }))
    else if (DIRTY_RE.test(msg)) deps.notifyNeedsInput(t("tasks.sync.dirty"))
    else deps.notifyError(t("tasks.sync.failed", { error: msg }))
    return false
  }
}
