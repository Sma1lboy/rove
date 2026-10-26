/** A split tab's panes as rail rows: one quiet row per pane under its task, none for a tab that is not split. */

import type { TabRow } from "rove-bridge/protocol"
import { type NavRow, tabLabel } from "./rail.ts"
import { isSplit, leafNames, leavesOf } from "./split-model.ts"

export const paneRowId = (taskId: string, tabId: string, leaf: string): string => `~pane:${taskId}:${tabId}:${leaf}`

/** `rows` with each task's panes right under it, ahead of its children; tabs in tab order, panes in reading order. */
export function withPanes(
  rows: readonly NavRow[],
  tabs: Readonly<Record<string, readonly TabRow[]>>,
): readonly NavRow[] {
  return rows.flatMap((row): NavRow[] => {
    if (row.kind !== "task") return [row]
    const panes = (tabs[row.task.id] ?? []).flatMap((tab): NavRow[] => {
      const split = tab.split
      if (!split || !isSplit(split)) return []
      const names = leafNames(split, tabLabel(tab))
      return leavesOf(split.root).map((leaf) => ({
        id: paneRowId(row.task.id, tab.id, leaf.id),
        kind: "pane",
        task: row.task,
        tab,
        leaf: leaf.id,
        label: names.get(leaf.id) ?? leaf.id,
        depth: row.depth + 1,
        ...(row.machine === undefined ? {} : { machine: row.machine }),
      }))
    })
    return [row, ...panes]
  })
}
