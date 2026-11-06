/** What `routine.list` answers, as the Routines page reads it. */

import type { Automation, AutomationRunStatus } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"

export interface RoutinesReply {
  readonly automations: readonly Automation[]
  readonly keepsDaemonAlive: boolean
  readonly lastRunStatus?: Readonly<Record<string, AutomationRunStatus>>
  /** The newest failure among recent runs; absent when none failed (or an older daemon). */
  readonly lastFailure?: Readonly<Record<string, { readonly at: string; readonly reason: string }>>
}
