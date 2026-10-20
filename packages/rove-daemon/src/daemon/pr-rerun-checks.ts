/**
 * On-demand restart of a PR's FAILING checks ("re-run failed checks"), for a
 * red chip the user believes is flaky rather than broken by the change.
 *
 * Reads the CURRENT rollup (so it restarts what the chip shows, not a stale
 * poll), then `gh run rerun <runId> --failed` once per distinct workflow run:
 * only the failed jobs restart, a matrix is one call, and passing jobs keep
 * their results. A failing check outside GitHub Actions (a legacy status from
 * another service) has no run id and is counted, not restarted.
 */

import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { type PrChecksUnavailable, failingCheckTargets, ghText } from "./pr-failing-checks.ts"
import { PR_VIEW_TIMEOUT_MS } from "./pr-status-collector.ts"

export interface PrRerunResult {
  /** Workflow runs whose failed jobs were restarted. */
  readonly rerunRuns: number
  /** Failing checks with no Actions run behind them, which `gh` cannot restart. */
  readonly external: number
  /** `gh`'s first refusal when a run could not be restarted (e.g. still in progress). */
  readonly refused?: string
  /** Set when the rollup could not be read at all. */
  readonly unavailable?: PrChecksUnavailable
}

/** Restart every failed Actions job on the PR. Never throws. */
export async function rerunFailedChecks(opts: {
  readonly worktreePath: string
  readonly prNumber: number
}): Promise<PrRerunResult> {
  try {
    const rollupRead = await ghText(
      ["pr", "view", String(opts.prNumber), "--json", "statusCheckRollup"],
      opts.worktreePath,
      PR_VIEW_TIMEOUT_MS,
    )
    if (!rollupRead.ok) {
      logDaemonInfo("pr-rerun-checks", `gh could not read PR #${opts.prNumber}: ${rollupRead.detail}`)
      return { rerunRuns: 0, external: 0, unavailable: { reason: "gh_failed", detail: rollupRead.detail } }
    }
    const parsed = JSON.parse(rollupRead.stdout) as { statusCheckRollup?: unknown }
    const targets = failingCheckTargets(Array.isArray(parsed.statusCheckRollup) ? parsed.statusCheckRollup : [])
    const runIds = [...new Set(targets.flatMap((target) => (target.runId ? [target.runId] : [])))]
    const external = targets.filter((target) => target.runId === null).length
    let rerunRuns = 0
    let refused: string | undefined
    for (const runId of runIds) {
      const res = await ghText(["run", "rerun", runId, "--failed"], opts.worktreePath, PR_VIEW_TIMEOUT_MS)
      if (res.ok) rerunRuns++
      else {
        logDaemonInfo("pr-rerun-checks", `gh refused to re-run run ${runId} of PR #${opts.prNumber}: ${res.detail}`)
        refused ??= res.detail
      }
    }
    return { rerunRuns, external, ...(refused === undefined ? {} : { refused }) }
  } catch (err) {
    logDaemonError("pr-rerun-checks", err)
    return {
      rerunRuns: 0,
      external: 0,
      unavailable: { reason: "gh_error", detail: err instanceof Error ? err.message : String(err) },
    }
  }
}
