/**
 * Row menu "Sync with base" / the sidebar's `↓N` drift chip. Shaped like
 * `land-task-action.ts`: the outcomes a human must act on (conflict, worktree
 * too dirty to merge into) arrive as MARKERS in the daemon's error message, so
 * they get the attention tone and name the files; anything else is an error.
 * React-free for unit tests. No confirm, unlike landing: a merge from base is
 * additive and `git merge --abort` undoes it.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

const CONFLICT_RE = /SYNC_CONFLICT(?:: )?(.*)/
const DIRTY_RE = /SYNC_WORKTREE_DIRTY(?:: )?(.*)/

export interface SyncBaseDeps {
  readonly orchestrator: Pick<RemoteOrchestrator, "syncBase">
  readonly notifyInfo: (message: string) => void
  /** Attention tone (yellow): nothing broke, but a human is needed next. */
  readonly notifyNeedsInput: (message: string) => void
  readonly notifyError: (message: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
}

/** True when the worktree ends up current (incl. already was); false otherwise, already reported. */
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
    // The merge stays IN PLACE on conflict: name the files the user (or engine) will resolve.
    const dirty = DIRTY_RE.exec(msg)
    if (conflict) deps.notifyNeedsInput(t("tasks.sync.conflict", { files: conflict[1]?.trim() || "?" }))
    else if (dirty) deps.notifyNeedsInput(t("tasks.sync.dirty", { files: dirty[1]?.trim() || "?" }))
    else deps.notifyError(t("tasks.sync.failed", { error: msg }))
    return false
  }
}
