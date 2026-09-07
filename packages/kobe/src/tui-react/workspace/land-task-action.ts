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
  readonly orchestrator: Pick<RemoteOrchestrator, "landTask" | "landPreflight">
  /**
   * Resolved confirm: true = go ahead. The caller owns the dialog stack, but
   * NOT the copy — the body arrives rendered because it names the destination
   * branch and the commit count, which only the preflight below knows.
   */
  readonly confirm: (body: string) => Promise<boolean>
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
 *
 * The preflight runs FIRST, and it is the reason this function grew a step: the
 * checks that refuse a land (detached base, dirty base, empty branch) all used
 * to run after the user had already confirmed, so every refusal arrived as an
 * error toast for a merge they thought was happening. Now a refusal replaces
 * the dialog instead of following it, and the dialog that does open names what
 * it is merging into.
 */
export async function landTaskAction(deps: LandTaskDeps, taskId: string, branchLabel: string): Promise<boolean> {
  const { t } = deps
  let preflight: Awaited<ReturnType<RemoteOrchestrator["landPreflight"]>>
  try {
    preflight = await deps.orchestrator.landPreflight(taskId)
  } catch (err) {
    // A preflight that cannot even run (task gone, repo unreachable) is a
    // failure, not a refusal — same reporting as a failed land.
    deps.notifyError(t("worktrees.land.failed", { error: err instanceof Error ? err.message : String(err) }))
    console.error("[rove land] preflight failed:", err)
    return false
  }
  if (preflight.refusal) {
    // The refusal carries the exact message the land would have thrown, so no
    // new strings: the dirty base keeps its own actionable copy (never
    // `git stash` here), everything else reports what the merge would have.
    if (preflight.refusal === "MAIN_CHECKOUT_DIRTY") deps.notifyNeedsInput(t("worktrees.land.dirtyBase"))
    else deps.notifyError(t("worktrees.land.failed", { error: preflight.message ?? preflight.refusal }))
    return false
  }
  const body = t(preflight.ahead === 1 ? "worktrees.land.confirmBodyOne" : "worktrees.land.confirmBody", {
    branch: branchLabel,
    landedOn: preflight.landedOn,
    // `?` only when git exited 0 and printed something that is not a number —
    // unreachable in practice, and still better than inventing a count on the
    // screen whose whole job is to show the real one.
    commits: preflight.ahead ?? "?",
  })
  if (!(await deps.confirm(body))) return false
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
