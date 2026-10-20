/** Decision gates as the phone sees them: the daemon's `gates` channel joined to task titles. */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { ActiveGate } from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import type { AttentionRow, GateRow } from "./protocol.ts"

/** Open gates, plus answered ones the engine has not received; oldest first. */
export function gateRows(gates: readonly ActiveGate[], tasks: readonly SerializedTask[]): GateRow[] {
  const titles = new Map(tasks.map((t) => [t.id, t.title]))
  return gates
    .filter((g) => g.status === "open" || (g.status === "answered" && g.handoff === "undelivered"))
    .map((g) => ({
      id: g.id,
      taskId: g.taskId,
      tabId: g.tabId,
      question: g.question,
      options: g.options.map((o) => ({ key: o.key, label: o.label, ...(o.detail ? { detail: o.detail } : {}) })),
      ...(g.recommended ? { recommended: g.recommended } : {}),
      ...(g.context ? { context: g.context } : {}),
      status: g.status as GateRow["status"],
      ...(g.status === "answered" && g.handoff ? { handoff: g.handoff } : {}),
      createdAt: g.createdAt,
      label: titles.get(g.taskId) ?? g.taskId,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/**
 * Would a legacy `attention.dismiss {taskId, tabId}` (no delivery id) have only decision rows
 * to hit? Then it is a tap on a gate row by a client that predates `gateId`; the daemon's
 * stored episodes are not what it meant, so the bridge refuses instead of guessing.
 */
export function dismissHitsOnlyGates(
  attention: readonly AttentionRow[],
  taskId: string,
  tabId: string | undefined,
): boolean {
  const here = attention.filter((r) => r.taskId === taskId && r.tabId === (tabId ?? null))
  return here.length > 0 && here.every((r) => r.state === "decision_needed")
}
