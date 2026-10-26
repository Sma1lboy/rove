/** The rail's Archived fold: the TUI's `pushArchived` (`tree-core.ts`) over `TasksPayload.archived`. */

import type { TaskRow } from "rove-bridge/protocol"
import { type FoldState, type NavRow, navRows } from "./rail.ts"

/** The Archived fold row's id, as the TUI's `ARCHIVED_ROW_ID`. */
export const ARCHIVED_ROW_ID = "~archived"

/**
 * Close the rail with the Archived fold: one row counting the archived tasks, and when open
 * those tasks hanging under it as its children, nested under their archived parents. None archived adds nothing.
 */
export function withArchived(
  rows: readonly NavRow[],
  archived: readonly TaskRow[],
  expanded: boolean,
  fold?: FoldState,
): readonly NavRow[] {
  if (archived.length === 0) return rows
  const head: NavRow = { id: ARCHIVED_ROW_ID, kind: "archived", count: archived.length, expanded }
  if (!expanded) return [...rows, head]
  // One header-less group one generation down: `navRows` nests and folds it like any project, then its header is dropped.
  const under = navRows([{ repo: "", label: "", key: ARCHIVED_ROW_ID, tasks: archived }], "", new Set(), fold, 1)
  return [...rows, head, ...under.filter((row) => row.kind !== "project")]
}
