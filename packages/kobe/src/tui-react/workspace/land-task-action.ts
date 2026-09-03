/**
 * Land a task's branch into its base repo — the flow behind BOTH the
 * Worktrees page's `l` and the sidebar row menu's "Land into base branch".
 *
 * Its own module because the two callers differ only in what surrounds it
 * (the page has a busy row and a list to refetch; the sidebar has neither),
 * while everything that makes landing correct is the same: the confirm the
 * user must clear, the two cleanup outcomes that need a follow-up toast
 * rather than an error, and the two failure messages the daemon returns as
 * codes because they are the ones a human can act on (a merge conflict, a
 * dirty base checkout).
 *
 * React-free so it can be unit-tested and so neither caller has to be the
 * one that "owns" landing.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

const LAND_CONFLICT_RE = /LAND_CONFLICT/
const MAIN_DIRTY_RE = /MAIN_CHECKOUT_DIRTY/

export interface LandTaskDeps {
  readonly orchestrator: Pick<RemoteOrchestrator, "landTask">
  /** Resolved confirm: true = go ahead. The caller owns the dialog stack. */
  readonly confirm: (branchLabel: string) => Promise<boolean>
  readonly notifyInfo: (message: string) => void
  /** Attention tone (yellow): landed, but something needs a human next. */
  readonly notifyNeedsInput: (message: string) => void
  readonly notifyError: (message: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
  /** Where this TUI is running, so the daemon can refuse to delete its own
   *  cwd instead of pulling the floor out from under it. */
  readonly callerCwd: string
}

/**
 * Run one land. Resolves true when the branch landed (whatever the cleanup
 * did afterwards), false on a refusal, a declined confirm, or a failure —
 * every one of which has already been reported through the notifiers.
 */
export async function landTaskAction(deps: LandTaskDeps, taskId: string, branchLabel: string): Promise<boolean> {
  const { t } = deps
  if (!(await deps.confirm(branchLabel))) return false
  try {
    // Land removes the worktree by default — same as the CLI.
    const res = await deps.orchestrator.landTask(taskId, { callerCwd: deps.callerCwd })
    deps.notifyInfo(t("worktrees.land.done", { branch: res.branch, landedOn: res.landedOn, commit: res.commit }))
    // Two cleanup outcomes carry information and neither is ever thrown.
    // They need different copy: a refused removal leaves the directory in
    // place, while a removal whose bookkeeping write failed took the
    // directory but left the task still pointing at it — `worktreeKept`
    // would be actively wrong for the second.
    const cleanup = res.worktree
    if (cleanup && !cleanup.removed) {
      deps.notifyNeedsInput(t("worktrees.land.worktreeKept", { reason: cleanup.reason ?? "refused" }))
    } else if (cleanup?.reason) {
      deps.notifyNeedsInput(t("worktrees.land.worktreePathStale", { reason: cleanup.reason }))
    }
    if (cleanup?.residue) {
      deps.notifyNeedsInput(
        t("worktrees.land.worktreeResidue", { path: cleanup.residue.path, reason: cleanup.residue.reason }),
      )
    }
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (LAND_CONFLICT_RE.test(msg)) deps.notifyNeedsInput(t("worktrees.land.conflict", { files: msg }))
    else if (MAIN_DIRTY_RE.test(msg)) deps.notifyNeedsInput(t("worktrees.land.dirtyBase"))
    else deps.notifyError(t("worktrees.land.failed", { error: msg }))
    console.error("[rove land] failed:", err)
    return false
  }
}
