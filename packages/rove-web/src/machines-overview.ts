/** What the Machines overview reads off the task feed: one machine's tasks, split by the rail's states, and its failure in words. */

import type { TaskRow } from "rove-bridge/protocol"
import { RAIL_STATES, type RailState, stateOf } from "./rail-states.ts"

/** The `reason` values `machines.list` can carry that the page has a sentence for (`i18n/machines.ts`). */
const REASONS: ReadonlySet<string> = new Set([
  "refused",
  "timeout",
  "host-key-changed",
  "host-key-unverified",
  "auth-denied",
  "unresolved",
  "ssh-failed",
  "no-rove",
  "no-daemon",
  "bad-status",
  "handshake",
  "no-forwarding",
  "lost",
])

/** The i18n key of the sentence for a machine's failure reason; null when it is online or the reason is one this page does not know. */
export function reasonKey(reason: string | null | undefined): string | null {
  return reason && REASONS.has(reason) ? `machines.reason.${reason}` : null
}

/** The tasks the feed holds for the machine `alias`; a routine's run and a task being deleted stay out, as in the rail. */
export function tasksOfMachine(tasks: readonly TaskRow[], alias: string): TaskRow[] {
  return tasks.filter((task) => task.machine?.id === alias && !task.routine && !task.deleting)
}

/** `tasks` by rail state, most urgent first, empty states left out; each state keeps the feed's order. */
export function groupByState(
  tasks: readonly TaskRow[],
): Array<{ readonly state: RailState; readonly tasks: TaskRow[] }> {
  const groups = RAIL_STATES.map((state) => ({ state, tasks: [] as TaskRow[] }))
  for (const task of tasks) groups[RAIL_STATES.indexOf(stateOf(task))]?.tasks.push(task)
  return groups.filter((group) => group.tasks.length > 0)
}
