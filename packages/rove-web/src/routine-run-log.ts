/** What the Routines page's run log reads of a run: its outcome class, source and how long it took. */

import type { AutomationRun } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"

/** `ok` reached an engine (or a script exited 0), `blocked` waits on a person or a limit, `failed` needs a look, `skipped` was healthy or a miss. */
export const OUTCOMES = ["ok", "blocked", "failed", "skipped"] as const
export type Outcome = (typeof OUTCOMES)[number]

export function outcomeOf(run: Pick<AutomationRun, "status">): Outcome {
  switch (run.status) {
    case "dispatched":
    case "revived":
    case "ran":
      return "ok"
    case "skipped_blocked":
      return "blocked"
    case "dispatch_failed":
    case "skipped_unavailable":
    case "script_failed":
      return "failed"
    default:
      return "skipped"
  }
}

/** The daemon records what fired a run as `trigger`; the page names it the way the CLI and docs do. */
export const SOURCES = { scheduled: "schedule", manual: "manual", webhook: "webhook" } as const

/**
 * How long the run took, when the daemon recorded an end: a precheck skip has the command's own duration,
 * an engine run whose agent reported has the time to that report. Null otherwise (the run itself has no end time).
 */
export function runDurationMs(
  run: Pick<AutomationRun, "status" | "at" | "precheckResult" | "response">,
): number | null {
  if (run.status === "skipped_precheck") return run.precheckResult?.durationMs ?? null
  // A script's response is stored the moment it ends, at the run's own `at`: no span to show.
  if (run.status === "ran" || run.status === "script_failed") return null
  const start = Date.parse(run.at)
  const end = Date.parse(run.response?.at ?? "")
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}

/** `routine` null = every routine; `outcome` null = every outcome. Newest first. */
export function filterRuns(
  byRoutine: Readonly<Record<string, readonly AutomationRun[]>>,
  routine: string | null,
  outcome: Outcome | null,
): AutomationRun[] {
  const pool = routine === null ? Object.values(byRoutine).flat() : (byRoutine[routine] ?? [])
  return pool
    .filter((run) => outcome === null || outcomeOf(run) === outcome)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.runNumber - a.runNumber)
}
