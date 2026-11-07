import type { TaskActivityState } from "./contracts.ts"

/** Shared task urgency; both in-flight states outrank attention for task-level busy protection. */
export const STATUS_PRIORITY = {
  busy: 0,
  running: 1,
  "needs-input": 2,
  attention: 3,
  unseen: 4,
  idle: 5,
} as const

const ACTIVITY_PRIORITY: Readonly<Record<TaskActivityState, number>> = {
  running: STATUS_PRIORITY.running,
  dead: STATUS_PRIORITY.attention,
  error: STATUS_PRIORITY.attention,
  rate_limited: STATUS_PRIORITY.attention,
  permission_needed: STATUS_PRIORITY["needs-input"],
  turn_complete: STATUS_PRIORITY.unseen,
  idle: STATUS_PRIORITY.idle,
}

export function activityPriority(state: TaskActivityState): number {
  return ACTIVITY_PRIORITY[state]
}
