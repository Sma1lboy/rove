/**
 * Routine runs worth handing to the WeChat agent: for every routine created
 * with `--notify`, a run's response once it exists (a script's stdout, or an
 * agent's report), and a run that needs a human (`script_failed`,
 * `dispatch_failed`, …). The agent decides what reaches the owner.
 *
 * The first observation only seeds: a daemon restart must not replay a
 * routine's history into the agent.
 */

import type { AutomationRun } from "@sma1lboy/rove-daemon/daemon/contracts"
import { automationRunNeedsAttention } from "@sma1lboy/rove-daemon/daemon/contracts"

export interface NotifyingRoutine {
  readonly id: string
  readonly name: string
  /** Newest first, responses projected (`automation.runs`). */
  readonly runs: readonly AutomationRun[]
}

export interface RoutinePush {
  readonly name: string
  readonly run: AutomationRun
}

/** An engine run still owes its report: hold it until the response lands or the delivery gives up. */
function awaitingReport(run: AutomationRun): boolean {
  return (run.status === "dispatched" || run.status === "revived") && run.deliveryStatus === "awaiting"
}

export class RoutineTracker {
  private readonly handled = new Set<string>()
  private seeded = false

  observe(routines: readonly NotifyingRoutine[]): RoutinePush[] {
    const pushes: RoutinePush[] = []
    const current = new Set<string>()
    for (const routine of routines) {
      for (const run of routine.runs) {
        current.add(run.id)
        if (this.handled.has(run.id)) continue
        if (!this.seeded) {
          this.handled.add(run.id)
          continue
        }
        if (run.response || automationRunNeedsAttention(run.status)) {
          pushes.push({ name: routine.name, run })
          this.handled.add(run.id)
        } else if (!awaitingReport(run)) {
          this.handled.add(run.id)
        }
      }
    }
    this.seeded = true
    // Forget runs retention dropped, so the set stays the size of the history.
    for (const id of this.handled) if (!current.has(id)) this.handled.delete(id)
    return pushes.reverse()
  }
}

/** One agent message per run, oldest first: `[Routine <name> #<run>]`, then what it said. */
export function renderRoutineRuns(pushes: readonly RoutinePush[]): string[] {
  return pushes.map(({ name, run }) => {
    const failed = automationRunNeedsAttention(run.status)
    const header = `[Routine ${name} #${run.runNumber}${failed ? ` ${run.status.replace(/_/g, " ")}` : ""}]`
    const body = [run.response?.text, failed ? run.error : undefined].filter(Boolean).join("\n")
    return body ? `${header}\n${body}` : header
  })
}
