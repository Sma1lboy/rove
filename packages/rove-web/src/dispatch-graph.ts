/**
 * The Dispatch page's network: senders on the left, the daemon hub in the middle, targets on
 * the right, one wire per sender→target pair through the hub. Pure: the view measures the
 * stage and draws what this returns.
 */

import type { DispatchRow } from "rove-bridge/protocol"

export interface GraphNode {
  /** `you`, `routine:<name>`, or `<taskId>::<tabId>`. */
  readonly key: string
  readonly taskId: string | null
  readonly tabId: string | null
  readonly routine?: string
}

export interface Graph {
  readonly senders: readonly GraphNode[]
  readonly targets: readonly GraphNode[]
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** One wire: sender port → hub in-port, hub out-port → target port, as two cubic Béziers. */
export interface Wire {
  readonly from: Point
  readonly hubIn: Point
  readonly hubOut: Point
  readonly to: Point
}

const endKey = (taskId: string, tabId: string | null) => `${taskId}::${tabId ?? "tab-1"}`

export function senderOf(row: DispatchRow): GraphNode {
  if (row.from) return { key: endKey(row.from.taskId, row.from.tabId), taskId: row.from.taskId, tabId: row.from.tabId }
  if (row.routine) return { key: `routine:${row.routine}`, taskId: null, tabId: null, routine: row.routine }
  return { key: "you", taskId: null, tabId: null }
}

export function targetOf(row: DispatchRow): GraphNode {
  return { key: endKey(row.to.taskId, row.to.tabId), taskId: row.to.taskId, tabId: row.to.tabId }
}

/** Nodes in the order their first dispatch appears, so a node keeps its place as rows arrive. */
export function graphOf(rows: readonly DispatchRow[]): Graph {
  const senders = new Map<string, GraphNode>()
  const targets = new Map<string, GraphNode>()
  for (const row of rows) {
    const s = senderOf(row)
    const t = targetOf(row)
    if (!senders.has(s.key)) senders.set(s.key, s)
    if (!targets.has(t.key)) targets.set(t.key, t)
  }
  return { senders: [...senders.values()], targets: [...targets.values()] }
}

function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  }
}

/** Horizontal tangents at both ends: the wire leaves and enters every port level. */
function controls(a: Point, b: Point): [Point, Point] {
  const mid = (a.x + b.x) / 2
  return [
    { x: mid, y: a.y },
    { x: mid, y: b.y },
  ]
}

export function wirePath(w: Wire): string {
  const [c1, c2] = controls(w.from, w.hubIn)
  const [c3, c4] = controls(w.hubOut, w.to)
  return [
    `M${w.from.x} ${w.from.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${w.hubIn.x} ${w.hubIn.y}`,
    `M${w.hubOut.x} ${w.hubOut.y} C${c3.x} ${c3.y} ${c4.x} ${c4.y} ${w.to.x} ${w.to.y}`,
  ].join(" ")
}

/** Where on the wire `p` (0 = sender, 1 = target) is; the hub crossing is instant. */
export function pointOn(w: Wire, p: number): Point {
  const k = Math.min(1, Math.max(0, p))
  if (k < 0.5) {
    const [c1, c2] = controls(w.from, w.hubIn)
    return cubic(w.from, c1, c2, w.hubIn, k * 2)
  }
  const [c3, c4] = controls(w.hubOut, w.to)
  return cubic(w.hubOut, c3, c4, w.to, (k - 0.5) * 2)
}

/** Ease in and out, so a courier sets off and arrives instead of sliding. */
export function ease(t: number): number {
  return (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2
}
