/**
 * Land a task's branch into its base repo: the flow behind the Worktrees
 * page's `l` and the row menu's "Land". Shared: the confirm, the two cleanup
 * outcomes needing a toast, and the actionable failure codes (merge
 * conflict, dirty base). React-free.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

const LAND_CONFLICT_RE = /LAND_CONFLICT/
const MAIN_DIRTY_RE = /MAIN_CHECKOUT_DIRTY/

export interface LandTaskDeps {
  readonly orchestrator: Pick<RemoteOrchestrator, "landTask" | "landPreflight">
  /** true = go ahead. The body arrives rendered: only the preflight knows
   *  the destination branch and commit count. */
  readonly confirm: (body: string) => Promise<boolean>
  readonly notifyInfo: (message: string) => void
  /** Attention tone (yellow): landed, but something needs a human next. */
  readonly notifyNeedsInput: (message: string) => void
  readonly notifyError: (message: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
  /** This TUI's cwd, so the daemon refuses to delete it. */
  readonly callerCwd: string
}

/**
 * Run one land. True when the branch landed (whatever cleanup did); false on
 * refusal, declined confirm, or failure, all already reported. The preflight
 * runs FIRST so a refusal (detached/dirty base, empty branch) replaces the
 * dialog instead of following a confirm.
 */
export async function landTaskAction(deps: LandTaskDeps, taskId: string, branchLabel: string): Promise<boolean> {
  const { t } = deps
  let preflight: Awaited<ReturnType<RemoteOrchestrator["landPreflight"]>>
  try {
    preflight = await deps.orchestrator.landPreflight(taskId)
  } catch (err) {
    // A preflight that can't run is a failure, not a refusal.
    deps.notifyError(t("worktrees.land.failed", { error: err instanceof Error ? err.message : String(err) }))
    console.error("[rove land] preflight failed:", err)
    return false
  }
  if (preflight.refusal) {
    // Dirty base keeps its own actionable copy (never `git stash` here).
    if (preflight.refusal === "MAIN_CHECKOUT_DIRTY") deps.notifyNeedsInput(t("worktrees.land.dirtyBase"))
    else deps.notifyError(t("worktrees.land.failed", { error: preflight.message ?? preflight.refusal }))
    return false
  }
  const body = t(preflight.ahead === 1 ? "worktrees.land.confirmBodyOne" : "worktrees.land.confirmBody", {
    branch: branchLabel,
    landedOn: preflight.landedOn,
    // `?` only if git printed a non-number; never invent a count.
    commits: preflight.ahead ?? "?",
  })
  if (!(await deps.confirm(body))) return false
  try {
    // Land removes the worktree by default — same as the CLI.
    const res = await deps.orchestrator.landTask(taskId, { callerCwd: deps.callerCwd })
    deps.notifyInfo(t("worktrees.land.done", { branch: res.branch, landedOn: res.landedOn, commit: res.commit }))
    // Two non-thrown cleanup outcomes, different copy: a refused removal kept
    // the directory; a failed bookkeeping write removed it but left the task
    // pointing at it (`worktreeKept` would be wrong there).
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
