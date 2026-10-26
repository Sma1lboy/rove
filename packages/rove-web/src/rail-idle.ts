import type { NavRow } from "./rail.ts"

/**
 * A project with nothing going on (only its repo row, no tab open, not selected) is not listed,
 * as Claude's sidebar lists only projects with sessions; New task still reaches it.
 */
export function dropIdleProjects(
  rows: readonly NavRow[],
  tabs: Readonly<Record<string, readonly unknown[]>>,
  selectedTaskId: string | null,
  tabsSettled: boolean,
): readonly NavRow[] {
  const idleMain = (row: NavRow): boolean =>
    row.kind === "task" &&
    row.task.kind === "main" &&
    row.task.id !== selectedTaskId &&
    // Before the first tab sweep lands, unknown hides too, so a project never shows and then vanishes;
    // after it, unknown (the read failed) keeps the project.
    (tabsSettled ? tabs[row.task.id]?.length === 0 : (tabs[row.task.id]?.length ?? 0) === 0)
  const out: NavRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const head = rows[i]
    if (head?.kind !== "project") {
      if (head) out.push(head)
      continue
    }
    let end = i + 1
    while (end < rows.length && rows[end]?.kind !== "project") end++
    const under = rows.slice(i + 1, end)
    if (!under.every(idleMain)) out.push(head, ...under)
    i = end - 1
  }
  return out
}
