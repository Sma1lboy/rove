/** The rail's rows as nested blocks: drag steps, where a drop lands, and the child rows' tree guides. */

import type { TaskRow } from "rove-bridge/protocol"
import type { NavRow } from "./rail.ts"

/**
 * How many `task.move` steps take `from` to `to`'s place, in the daemon's move partition
 * (`movePartition`): all mains (projects), or one repo's tasks with the same pin. Null across partitions.
 */
export function dragSteps(tasks: readonly TaskRow[], from: TaskRow, to: TaskRow): number | null {
  const main = from.kind === "main"
  const same = (task: TaskRow) =>
    main ? task.kind === "main" : task.kind !== "main" && task.repo === from.repo && !task.pinned === !from.pinned
  if (from.id === to.id || !same(to)) return null
  const ids = tasks
    .filter(same)
    .sort((a, b) => (a.order ?? a.rank) - (b.order ?? b.rank))
    .map((task) => task.id)
  return ids.indexOf(to.id) - ids.indexOf(from.id)
}

export type DropSide = "above" | "below"

/** {@link dragSteps} for a drop that lands right above or right below `to`. */
export function dropSteps(tasks: readonly TaskRow[], from: TaskRow, to: TaskRow, side: DropSide): number | null {
  const steps = dragSteps(tasks, from, to)
  if (steps === null) return null
  if (side === "above" && steps > 0) return steps - 1
  if (side === "below" && steps < 0) return steps + 1
  return steps
}

/** A row's nesting level: a project 0, its tasks and routine count 1, a child task or a pane one deeper than its parent. */
const depthOf = (row: NavRow | undefined): number =>
  row === undefined || row.kind === "project" ? 0 : row.kind === "task" || row.kind === "pane" ? row.depth : 1

/** Where the block starting at `i` (the row and every row nested under it) ends. */
export function blockEnd(rows: readonly NavRow[], i: number): number {
  const depth = depthOf(rows[i])
  let end = i + 1
  while (end < rows.length && depthOf(rows[end]) > depth) end++
  return end
}

/** One indent column of a child row: a line passing by, nothing, a line on to the next sibling, or the last sibling's hook. */
export type TreeGuide = "pipe" | "blank" | "tee" | "elbow"

/** The indent columns of the child row at `i`, outermost first (empty for a top-level row), as Claude's session tree draws them. */
export function treeGuides(rows: readonly NavRow[], i: number): TreeGuide[] {
  const depth = depthOf(rows[i])
  const guides: TreeGuide[] = []
  for (let d = 2; d <= depth; d++) {
    // The row at level `d` on this row's path has a later sibling: the first row after it at or above `d` sits at `d`.
    let j = i + 1
    while (j < rows.length && depthOf(rows[j]) > d) j++
    const more = j < rows.length && depthOf(rows[j]) === d
    guides.push(d === depth ? (more ? "tee" : "elbow") : more ? "pipe" : "blank")
  }
  return guides
}

/** `rows` with the dragged row's block moved right above or below the target's block, as it would land. */
export function previewDrop(rows: readonly NavRow[], fromId: string, toId: string, side: DropSide): readonly NavRow[] {
  const from = rows.findIndex((row) => row.id === fromId)
  if (from < 0 || fromId === toId) return rows
  const end = blockEnd(rows, from)
  const block = rows.slice(from, end)
  const rest = [...rows.slice(0, from), ...rows.slice(end)]
  const to = rest.findIndex((row) => row.id === toId)
  if (to < 0) return rows
  const at = side === "above" ? to : blockEnd(rest, to)
  return [...rest.slice(0, at), ...block, ...rest.slice(at)]
}
