/**
 * The run-health and trigger rules the Routines page reads, re-exported from the daemon contracts
 * so the web client takes them through `@sma1lboy/rove-core` (it has no direct dependency on the daemon package).
 */

export {
  AUTOMATION_EVENT_KINDS,
  automationRunNeedsAttention,
  automationTriggerMode,
  formatEventTrigger,
  formatEventTriggers,
  hasAutomationEventTrigger,
  routineRunResponseState,
} from "@sma1lboy/rove-daemon/daemon/contracts"
export type {
  Automation,
  AutomationEventFilter,
  AutomationEventKind,
  AutomationEventTrigger,
  AutomationRun,
  AutomationRunStatus,
  AutomationTriggerMode,
} from "@sma1lboy/rove-daemon/daemon/contracts"
