/**
 * Resolve-conflicts-with-agent action (sidebar row menu) — merge the base into
 * the row's worktree, and when that stops on conflicts, paste the conflicted
 * file list into the row's engine as a prompt instead of a toast.
 *
 * "Sync with base" already does the merge and already names the files; what
 * it could not do was hand them to the engine sitting in that same worktree,
 * so the user was left resolving by hand next to an agent that knows the
 * branch better than they do. This is the hand-off.
 *
 * Same module shape as `use-fix-ci.ts`, for the same two hazards:
 *
 *   - The identity guard IS the hazard. The merge takes a while, and by then
 *     the user may have switched tasks. A stale continuation must not paste
 *     one task's conflicts into another task's engine, so the selected
 *     worktree AND the send closure are both re-checked after the await.
 *   - The action can only run where the engine is. A menu opened on a row
 *     that is not the active task has no send closure to reach, so the host
 *     activates the row and PARKS the request here; the next
 *     `onEngineSendReady` for that task claims it. One slot: a second request
 *     before the first is claimed retargets it.
 *
 * The three non-conflict outcomes of the merge are reported exactly as "Sync
 * with base" reports them — a clean merge is the sync toast, a dirty worktree
 * is the attention toast, anything else is an error — because from the user's
 * side this IS a sync, one that keeps going when a sync would have stopped.
 *
 * `resolveConflictsAction` is the React-free core (daemon + prompt IO
 * injectable) so vitest can pin the outcome routing and the identity guard
 * without a daemon; `useResolveConflicts` binds it to the live locale.
 */

import type { MutableRefObject } from "react"
import { type ConflictPromptState, buildConflictPromptForWorktree } from "../../tui/ops/conflict-prompt"
import { useT } from "../i18n"
import { type SyncBaseOutcome, classifySyncError } from "./sync-base-action"

/** The row facts the prompt names — read at call time, not captured. */
interface ResolveConflictsTask {
  readonly branch: string
  readonly baseRef?: string
}

export type ResolveConflictsDeps = {
  worktree: string | null
  sendToEngineFn: MutableRefObject<((text: string) => void) | null>
  selectedWorktreeRef: { readonly current: string | null }
  notifyInfo: (message: string) => void
  /** Attention tone (yellow): nothing broke, but a human is needed next. */
  notifyNeedsInput: (message: string) => void
  notifyError: (message: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  /** The row's branch + base ref; `null` when the task is gone. */
  getTask: (taskId: string) => ResolveConflictsTask | null
  /** `RemoteOrchestrator.syncBase` — rejects with the `SYNC_*` markers. */
  syncBase: (taskId: string) => Promise<{ baseRef: string; alreadyCurrent: boolean }>
  build?: (worktree: string, state: ConflictPromptState) => Promise<string>
}

/** The daemon's `SYNC_CONFLICT: a, b` list back into paths. */
export function splitConflictFiles(list: string): string[] {
  return list
    .split(",")
    .map((file) => file.trim())
    .filter((file) => file.length > 0)
}

/** When the sync never named a base (it threw before returning one). */
const UNKNOWN_BASE = "the base branch"

export function resolveConflictsAction(deps: ResolveConflictsDeps): (taskId: string) => Promise<void> {
  const build = deps.build ?? buildConflictPromptForWorktree
  const { t } = deps
  return async function resolveConflicts(taskId: string): Promise<void> {
    const wt = deps.worktree
    const send = deps.sendToEngineFn.current
    const task = deps.getTask(taskId)
    if (!wt || !send || !task) return

    let outcome: SyncBaseOutcome
    try {
      const res = await deps.syncBase(taskId)
      // Merged clean, or nothing to merge: there is no conflict to hand over,
      // and saying so beats pasting a prompt with an empty file list.
      deps.notifyInfo(
        res.alreadyCurrent
          ? t("tasks.sync.alreadyCurrent", { base: res.baseRef })
          : t("tasks.sync.done", { base: res.baseRef }),
      )
      return
    } catch (err) {
      outcome = classifySyncError(err)
    }
    if (outcome.kind === "dirty") return deps.notifyNeedsInput(t("tasks.sync.dirty", { files: outcome.files }))
    if (outcome.kind === "error") return deps.notifyError(t("tasks.sync.failed", { error: outcome.message }))

    const files = splitConflictFiles(outcome.files)
    const prompt = await build(wt, { branch: task.branch || "HEAD", baseRef: task.baseRef || UNKNOWN_BASE, files })
    if (deps.selectedWorktreeRef.current !== wt || deps.sendToEngineFn.current !== send) return
    send(prompt)
    deps.notifyInfo(t("tasks.conflicts.handedOff", { count: files.length }))
  }
}

/** Parked request for a row that was not the active task (see the header). */
let pendingResolve: string | null = null

export function requestResolveConflicts(taskId: string): void {
  pendingResolve = taskId
}

/** Claim a parked request for this task. */
export function takeResolveConflicts(taskId: string | null): string | null {
  if (taskId === null || pendingResolve !== taskId) return null
  pendingResolve = null
  return taskId
}

export function useResolveConflicts(
  args: Omit<ResolveConflictsDeps, "t" | "build">,
): (taskId: string) => Promise<void> {
  const t = useT()
  return resolveConflictsAction({ ...args, t })
}
