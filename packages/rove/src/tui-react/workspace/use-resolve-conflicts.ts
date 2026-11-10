/**
 * Row-menu "Resolve conflicts": PTY paste+submit of the conflict prompt into
 * the row's engine. Same identity guard and park slot as `use-fix-ci.ts`: the
 * worktree and send closure are re-checked after the git await, and a
 * non-active row parks the request until its engine mounts.
 */

import type { MutableRefObject } from "react"
import {
  type PausedGitOperation,
  buildConflictPrompt,
  conflictedPaths,
  pausedGitOperation,
} from "../../tui/ops/conflict-prompt"
import { useT } from "../i18n"

export type ResolveConflictsDeps = {
  worktree: string | null
  sendToEngineFn: MutableRefObject<((text: string) => boolean) | null>
  selectedWorktreeRef: { readonly current: string | null }
  notifyError: (message: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  /** The row's branch; `null` when the task is gone. */
  getBranch: (taskId: string) => string | null
  readOperation?: (worktree: string) => PausedGitOperation | null
  readConflicts?: (worktree: string) => Promise<string[] | null>
}

export function resolveConflictsAction(deps: ResolveConflictsDeps): (taskId: string) => Promise<void> {
  const readOperation = deps.readOperation ?? pausedGitOperation
  const readConflicts = deps.readConflicts ?? conflictedPaths
  return async function resolveConflicts(taskId: string): Promise<void> {
    const wt = deps.worktree
    const send = deps.sendToEngineFn.current
    const branch = deps.getBranch(taskId)
    if (!wt || !send || branch === null) return
    // Re-read at send time: the user may have finished it by hand since the menu opened.
    const operation = readOperation(wt)
    if (!operation) return deps.notifyError(deps.t("files.toast.noPausedOperation"))
    const files = await readConflicts(wt)
    if (deps.selectedWorktreeRef.current !== wt || deps.sendToEngineFn.current !== send) return
    if (files === null) return deps.notifyError(deps.t("files.toast.conflictReadFailed"))
    if (!send(buildConflictPrompt({ operation, branch: branch || "HEAD", files }))) {
      deps.notifyError(deps.t("files.toast.conflictSendFailed"))
    }
  }
}

/** Parked request for a row that was not the active task. */
let pendingResolve: string | null = null

export function requestResolveConflicts(taskId: string): void {
  pendingResolve = taskId
}

export function takeResolveConflicts(taskId: string | null): string | null {
  if (taskId === null || pendingResolve !== taskId) return null
  pendingResolve = null
  return taskId
}

export function useResolveConflicts(
  args: Omit<ResolveConflictsDeps, "t" | "readOperation" | "readConflicts">,
): (taskId: string) => Promise<void> {
  const t = useT()
  return resolveConflictsAction({ ...args, t })
}
