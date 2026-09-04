/**
 * Fix-failing-checks action (sidebar row menu) — a PTY paste+submit of the CI
 * prompt into the row's engine session.
 *
 * Deliberately the same module shape as `use-create-pr.ts`, for the same two
 * reasons:
 *
 *   - The identity guard IS the hazard. `pr.failingChecks` downloads job logs,
 *     which takes seconds, and by then the user may have switched tasks. A
 *     stale continuation must not paste one task's CI failure into another
 *     task's engine, so the selected worktree AND the send closure are both
 *     re-checked after the await.
 *   - The action can only run where the engine is. A menu opened on a row that
 *     is not the active task has no send closure to reach, so the host
 *     activates the row and PARKS the request here; the next
 *     `onEngineSendReady` for that task claims it. One slot, like create-PR:
 *     a second request before the first is claimed retargets it.
 *
 * `fixCIAction` is the React-free core (daemon + prompt IO injectable) so
 * vitest can pin the empty-result toast and the identity guard without a
 * daemon; `useFixCI` binds it to the live locale.
 */

import type { MutableRefObject } from "react"
import { type CIFailingCheck, buildCIPromptForWorktree } from "../../tui/ops/ci-prompt"
import { useT } from "../i18n"

/** The row facts the prompt names — read at call time, not captured. */
interface FixCITask {
  readonly branch: string
  readonly prNumber?: number
}

export type FixCIDeps = {
  worktree: string | null
  sendToEngineFn: MutableRefObject<((text: string) => void) | null>
  selectedWorktreeRef: { readonly current: string | null }
  notifyError: (message: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  /** The row's branch + PR number; `null` when the task is gone. */
  getTask: (taskId: string) => FixCITask | null
  /** `RemoteOrchestrator.failingChecks`. */
  fetchChecks: (taskId: string) => Promise<{ checks: readonly CIFailingCheck[]; totalFailing: number }>
  build?: typeof buildCIPromptForWorktree
}

export function fixCIAction(deps: FixCIDeps): (taskId: string) => Promise<void> {
  const build = deps.build ?? buildCIPromptForWorktree
  return async function fixCI(taskId: string): Promise<void> {
    const wt = deps.worktree
    const send = deps.sendToEngineFn.current
    const task = deps.getTask(taskId)
    if (!wt || !send || !task) return
    const { checks, totalFailing } = await deps.fetchChecks(taskId)
    // `gh` unavailable, the run expired, or the checks turned green while the
    // menu was open. Saying so beats pasting a prompt with no evidence in it.
    if (checks.length === 0) return deps.notifyError(deps.t("files.toast.ciNoFailingChecks"))
    const prompt = await build(wt, {
      branch: task.branch || "HEAD",
      ...(task.prNumber === undefined ? {} : { prNumber: task.prNumber }),
      checks,
      totalFailing,
    })
    if (deps.selectedWorktreeRef.current !== wt || deps.sendToEngineFn.current !== send) return
    send(prompt)
  }
}

/** Parked request for a row that was not the active task (see the header). */
let pendingFixCI: string | null = null

export function requestFixCI(taskId: string): void {
  pendingFixCI = taskId
}

/** Claim a parked request for this task. */
export function takeFixCI(taskId: string | null): string | null {
  if (taskId === null || pendingFixCI !== taskId) return null
  pendingFixCI = null
  return taskId
}

export function useFixCI(args: Omit<FixCIDeps, "t" | "build">): (taskId: string) => Promise<void> {
  const t = useT()
  return fixCIAction({ ...args, t })
}
