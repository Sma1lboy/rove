/**
 * Row id vocabulary for the sidebar tree's flat cursor array. Separate from
 * `tree-core.ts` (which re-exports it) so the PTY registry, chord parsers and
 * the context menu can spell ids without the tree builder.
 *
 * Every sentinel is un-ULID-like and free of {@link TAB_ROW_SEPARATOR}, so
 * `parseRowId` yields a task id no task can have — an unhandled sentinel falls
 * through to a lookup miss instead of acting on a real task.
 */

/** Separator between a task id and a tab id in a tab row's id. Matches the
 *  PTY registry's key format so one parse rule covers both. */
const TAB_ROW_SEPARATOR = "::"

/** Navigation id of the narrow-mode "↩ recent" jump row. */
export const RECENT_ROW_ID = "~recent"

/**
 * Scratch section header id. Not a repo path, so project-header lookups (move
 * mode, context menu, `mainTaskIdOfProject`) just miss — no main task, no repo.
 */
export const SCRATCH_SECTION_ID = "~scratch"

/** Navigation id of a machine section header. */
export function machineRowId(alias: string): string {
  return `~machine:${alias}`
}

/** A project's routine count row id; carries the project key so rows stay distinct. */
export function routinesRowId(projectKey: string): string {
  return `~routines:${projectKey}`
}

/** The project key a routines row id names, or null for any other id. */
export function projectKeyOfRoutinesRow(id: string): string | null {
  return id.startsWith("~routines:") ? id.slice("~routines:".length) : null
}

/** Compose a tab row's navigation id. */
export function tabRowId(taskId: string, tabId: string): string {
  return `${taskId}${TAB_ROW_SEPARATOR}${tabId}`
}

/**
 * A task row id yields `tabId: null`. Task ids are ULIDs and tab ids `tab-N`,
 * so splitting on the first separator is unambiguous.
 */
export function parseRowId(rowId: string): { taskId: string; tabId: string | null } {
  const at = rowId.indexOf(TAB_ROW_SEPARATOR)
  if (at < 0) return { taskId: rowId, tabId: null }
  return { taskId: rowId.slice(0, at), tabId: rowId.slice(at + TAB_ROW_SEPARATOR.length) }
}
