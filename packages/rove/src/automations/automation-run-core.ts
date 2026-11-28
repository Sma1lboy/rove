/**
 * The run-health rules the Routines page reads, re-exported from the daemon contracts so the web
 * client takes them through `@sma1lboy/rove` (it has no direct dependency on the daemon package).
 */

export { automationRunNeedsAttention, routineRunResponseState } from "@sma1lboy/rove-daemon/daemon/contracts"
export type { Automation, AutomationRun, AutomationRunStatus } from "@sma1lboy/rove-daemon/daemon/contracts"
