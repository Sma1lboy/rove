/**
 * Row-menu "Fix failing checks": PTY paste+submit of the CI prompt into the
 * row's engine. Same shape as `use-create-pr.ts`, for the same two hazards:
 *
 *   - Identity: `pr.failingChecks` downloads job logs (seconds) and the user may
 *     switch tasks meanwhile, so the selected worktree AND the send closure are
 *     re-checked after the await; one task's failure must never paste into another.
 *   - A non-active row has no send closure, so the host activates it and PARKS
 *     the request; the next `onEngineSendReady` for that task claims it. One
 *     slot: a second request before the claim retargets it.
 *
 * `fixCIAction` is the React-free core (IO injectable, vitest-able);
 * `useFixCI` binds the live locale.
 */

import type { MutableRefObject } from "react"
import { type CIFailingChecksRead, buildCIPromptForWorktree } from "../../tui/ops/ci-prompt"
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
  fetchChecks: (taskId: string) => Promise<CIFailingChecksRead>
  build?: typeof buildCIPromptForWorktree
}

/** `gh`'s stderr is multi-line (an error plus hints); a toast gets one line. */
function firstLine(detail: string): string {
  return (
    detail
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? detail.trim()
  )
}

export function fixCIAction(deps: FixCIDeps): (taskId: string) => Promise<void> {
  const build = deps.build ?? buildCIPromptForWorktree
  return async function fixCI(taskId: string): Promise<void> {
    const wt = deps.worktree
    const send = deps.sendToEngineFn.current
    const task = deps.getTask(taskId)
    if (!wt || !send || !task) return
    const { checks, totalFailing, unavailable } = await deps.fetchChecks(taskId)
    // `gh` never answered (not installed, not authenticated, no network), so
    // name `gh`, not "checks aren't red". The card fits 39 cells: the VERDICT
    // leads so it survives truncation; full stderr ("please run: gh auth
    // login") is in `~/.rove/daemon.log`.
    if (unavailable) {
      return deps.notifyError(deps.t("files.toast.ciChecksUnavailable", { detail: firstLine(unavailable.detail) }))
    }
    // Nothing red (run expired, or went green while the menu was open); better
    // than pasting a prompt with no evidence.
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

export function takeFixCI(taskId: string | null): string | null {
  if (taskId === null || pendingFixCI !== taskId) return null
  pendingFixCI = null
  return taskId
}

export function useFixCI(args: Omit<FixCIDeps, "t" | "build">): (taskId: string) => Promise<void> {
  const t = useT()
  return fixCIAction({ ...args, t })
}
