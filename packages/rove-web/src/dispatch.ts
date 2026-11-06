/**
 * The Dispatch page's prompts, read from the daemon's row alone (status, `at`, `statusAt`) and a
 * clock: where a prompt still travelling its wire is, where a failed one stopped, and which
 * status each target node shows.
 */

import type { DispatchRow } from "rove-bridge/protocol"
import { ease } from "./dispatch-graph.ts"

/** How long a prompt takes to run sender → hub → target after a paste lands. */
export const TRAVEL_MS = 1_800

export function settled(row: DispatchRow): boolean {
  return row.status === "done" || row.status === "failed"
}

/** 0 = at the sender, 1 = at the target, for a row that has not arrived yet; null once it has. */
export function flightOf(row: DispatchRow, now: number): number | null {
  if (row.status !== "delivered") return null
  const ran = (now - row.at) / TRAVEL_MS
  return ran >= 1 ? null : ease(ran)
}

/** Where on its wire a failed row stopped, when it never reached the target; null when it did. */
export function stoppedAt(row: DispatchRow): number | null {
  if (row.status !== "failed") return null
  const ran = (row.statusAt - row.at) / TRAVEL_MS
  return ran >= 1 ? null : ease(ran)
}

/** True while some prompt is still on its way, i.e. while the clock has to run every frame. */
export function moving(rows: readonly DispatchRow[], now: number): boolean {
  return rows.some((row) => flightOf(row, now) !== null)
}

/** What outranks the newest prompt on a target node: a question waiting for you, then work under way. */
const URGENT: Readonly<Record<string, number>> = { asking: 2, working: 1 }

/**
 * The status each target node (by key) shows: a prompt asking for you, else one being worked, else
 * its newest prompt. So a newer ✓ never hides a question, and an old prompt stuck on "delivered" never hides a newer one.
 */
export function statusByTarget(
  rows: readonly DispatchRow[],
  keyOf: (row: DispatchRow) => string,
): Map<string, DispatchRow["status"]> {
  const out = new Map<string, DispatchRow["status"]>()
  const rank = new Map<string, number>()
  for (const row of rows) {
    const key = keyOf(row)
    const mine = URGENT[row.status] ?? 0
    // Rows come oldest first: an equal rank is newer, so it wins.
    if (mine >= (rank.get(key) ?? 0)) {
      rank.set(key, mine)
      out.set(key, row.status)
    }
  }
  return out
}

/** The newest settled rows, newest first, for the history under the map. */
export function recent(rows: readonly DispatchRow[], count = 12): DispatchRow[] {
  return rows.filter(settled).slice(-count).reverse()
}
