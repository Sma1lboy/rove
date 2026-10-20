/**
 * Row menu "Re-run failed checks". No confirm: `--failed` restarts only the
 * red jobs, and the chip turns pending on the next PR poll. React-free for
 * unit tests.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

export interface RerunChecksDeps {
  readonly orchestrator: Pick<RemoteOrchestrator, "rerunFailedChecks">
  readonly notifyInfo: (message: string) => void
  /** Attention tone: nothing broke, but the restart has to happen elsewhere. */
  readonly notifyNeedsInput: (message: string) => void
  readonly notifyError: (message: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
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

export async function rerunChecksAction(deps: RerunChecksDeps, taskId: string): Promise<void> {
  const { t } = deps
  try {
    const res = await deps.orchestrator.rerunFailedChecks(taskId)
    if (res.unavailable) {
      deps.notifyError(t("files.toast.ciChecksUnavailable", { detail: firstLine(res.unavailable.detail) }))
      return
    }
    if (res.rerunRuns > 0) {
      deps.notifyInfo(t("tasks.rerun.started"))
    }
    if (res.refused) {
      deps.notifyError(t("tasks.rerun.refused", { detail: firstLine(res.refused) }))
    }
    if (res.external > 0) {
      deps.notifyNeedsInput(t("tasks.rerun.external"))
    }
    if (res.rerunRuns === 0 && !res.refused && res.external === 0) {
      // Went green (or the run expired) while the menu was open.
      deps.notifyInfo(t("tasks.rerun.none"))
    }
  } catch (err) {
    deps.notifyError(t("tasks.rerun.refused", { detail: err instanceof Error ? err.message : String(err) }))
  }
}
