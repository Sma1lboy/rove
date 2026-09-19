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
const DIRTY_RE = /SYNC_WORKTREE_DIRTY(?:: )?(.*)/

/**
 * Which of the daemon's refusals a failed `task.syncBase` was. The two named
 * outcomes carry the file list the daemon put after the marker (`"?"` when it
 * put nothing); anything else is a genuine failure with git's own message.
 */
export type SyncBaseOutcome =
  | { readonly kind: "conflict"; readonly files: string }
  | { readonly kind: "dirty"; readonly files: string }
  | { readonly kind: "error"; readonly message: string }

export function classifySyncError(err: unknown): SyncBaseOutcome {
  const message = err instanceof Error ? err.message : String(err)
  const conflict = CONFLICT_RE.exec(message)
  if (conflict) return { kind: "conflict", files: conflict[1]?.trim() || "?" }
  const dirty = DIRTY_RE.exec(message)
  if (dirty) return { kind: "dirty", files: dirty[1]?.trim() || "?" }
  return { kind: "error", message }
}

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
    const outcome = classifySyncError(err)
    // The merge is left IN PLACE on a conflict — the conflicted files are what
    // the user (or their engine, via "Resolve conflicts with agent") is about
    // to resolve, so name them.
    if (outcome.kind === "conflict") deps.notifyNeedsInput(t("tasks.sync.conflict", { files: outcome.files }))
    else if (outcome.kind === "dirty") deps.notifyNeedsInput(t("tasks.sync.dirty", { files: outcome.files }))
    else deps.notifyError(t("tasks.sync.failed", { error: outcome.message }))
    return false
  }
}
