import type { NavRow } from "./rail.ts"

/**
 * A main row with nothing to show (no tab open, not selected, no child task under it) is not listed,
 * and a project left with no row at all loses its header too. The main task stays: it is the
 * project's anchor, its place in the order and the address `rove api send` aims at, and its row is
 * back once it has a tab, a child or the selection. New task → "the project itself" selects it.
 * `keep` holds one open regardless: the main whose header Reorder is on needs a row for j/k to drag.
 */
export function dropIdleMains(
  rows: readonly NavRow[],
  tabs: Readonly<Record<string, readonly unknown[]>>,
  selectedTaskId: string | null,
  tabsSettled: boolean,
  keep: string | null = null,
): readonly NavRow[] {
  const idleMain = (row: NavRow): boolean =>
    row.kind === "task" &&
    row.task.kind === "main" &&
    // A parent keeps its row: dropping it would orphan the children nested under it.
    row.fold === undefined &&
    row.task.id !== selectedTaskId &&
    row.task.id !== keep &&
    // Before the first tab sweep lands, unknown hides too, so a row never shows and then vanishes;
    // after it, unknown (the read failed) keeps the row.
    (tabsSettled ? tabs[row.task.id]?.length === 0 : (tabs[row.task.id]?.length ?? 0) === 0)
  const shown = rows.filter((row) => !idleMain(row))
  // A header with no row before the next header (or the end) names an empty project.
  return shown.filter((row, i) => {
    if (row.kind !== "project" && row.kind !== "state") return true
    const next = shown[i + 1]
    return next !== undefined && next.kind !== "project" && next.kind !== "state"
  })
}
