/**
 * Which task rows just moved into a group a person acts on. Pure state over
 * successive `context` snapshots:
 *
 *   - the first snapshot only seeds — a daemon restart must not replay every
 *     task that was already waiting;
 *   - a new group must hold for two consecutive snapshots before it counts,
 *     so a row flickering through `ready-for-review` between turns is quiet;
 *   - only arrivals INTO {@link PUSH_GROUPS} are reported.
 */

import type { ContextPayload } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import type { TaskGroup } from "@sma1lboy/rove/src/lib/task-group.ts"
import { rowLine } from "./format.ts"

type ContextRow = ContextPayload["tasks"][number]

const PUSH_LABEL: Partial<Record<TaskGroup, string>> = {
  "waiting-on-you": "Needs you",
  landing: "Ready to merge",
  "ready-for-review": "Ready for review",
}

export class GroupTracker {
  private readonly settled = new Map<string, TaskGroup>()
  private readonly pending = new Map<string, TaskGroup>()
  private seeded = false

  /** Feed one snapshot; returns the rows that just settled into a push group. */
  observe(rows: readonly ContextRow[]): ContextRow[] {
    const arrivals: ContextRow[] = []
    const present = new Set<string>()
    for (const row of rows) {
      present.add(row.taskId)
      if (!this.seeded) {
        this.settled.set(row.taskId, row.group)
        continue
      }
      if (this.settled.get(row.taskId) === row.group) {
        this.pending.delete(row.taskId)
        continue
      }
      if (this.pending.get(row.taskId) !== row.group) {
        this.pending.set(row.taskId, row.group)
        continue
      }
      this.pending.delete(row.taskId)
      this.settled.set(row.taskId, row.group)
      if (PUSH_LABEL[row.group]) arrivals.push(row)
    }
    this.seeded = true
    for (const id of [...this.settled.keys()]) if (!present.has(id)) this.settled.delete(id)
    for (const id of [...this.pending.keys()]) if (!present.has(id)) this.pending.delete(id)
    return arrivals
  }
}

/** One push message for every arrival of a tick. */
export function renderArrivals(rows: readonly ContextRow[]): string {
  const lines: string[] = []
  for (const row of rows) lines.push(`${PUSH_LABEL[row.group] ?? row.group}:`, rowLine(row))
  const first = rows[0]
  if (first?.group === "waiting-on-you") lines.push(`Reply: send ${first.taskId.slice(-6)} <text>`)
  return lines.join("\n")
}
