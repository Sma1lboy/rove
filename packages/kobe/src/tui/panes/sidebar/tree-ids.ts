/**
 * The sidebar tree's ID VOCABULARY — what a row is called in the one flat
 * array the cursor indexes into.
 *
 * Split from `tree-core.ts`, which decides what rows EXIST. These names are
 * read by code that never builds a tree: the PTY registry composes the same
 * `taskId::tabId` key, keyboard chords parse a row id back apart, and the
 * context menu asks whether an id is a sentinel. Keeping them here means those
 * callers do not pull in the tree builder to spell a string.
 *
 * Every sentinel below is deliberately un-ULID-like and free of
 * {@link TAB_ROW_SEPARATOR}: `parseRowId` on one yields a task id no task can
 * have, so a chord that does not special-case it falls through to a lookup
 * miss instead of acting on a real task.
 *
 * `tree-core.ts` re-exports all of it, so importers keep their existing path.
 */

/** Separator between a task id and a tab id in a tab row's id. Matches the
 *  PTY registry's key format so one parse rule covers both. */
const TAB_ROW_SEPARATOR = "::"

/** Navigation id of the narrow-mode "↩ recent" jump row. */
export const RECENT_ROW_ID = "~recent"

/**
 * Header id of the Scratch section. Not a repo path, so project-header
 * consumers (move mode, context menu, `mainTaskIdOfProject`) that look it up
 * simply miss — a Scratch header has no main task to move and no repo to file
 * into.
 */
export const SCRATCH_SECTION_ID = "~scratch"

/** Navigation id of a machine section header. */
export function machineRowId(alias: string): string {
  return `~machine:${alias}`
}

/**
 * Navigation id of a project's routine count row, carrying the project key so
 * two projects' rows stay distinct.
 */
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
 * Split a row id back into its parts. A task row id has no separator and
 * yields `tabId: null` — callers switch on that rather than string-matching
 * the separator themselves.
 *
 * Task ids are ULIDs and tab ids are `tab-N`, so neither contains the
 * separator; splitting on the FIRST occurrence is unambiguous either way.
 */
export function parseRowId(rowId: string): { taskId: string; tabId: string | null } {
  const at = rowId.indexOf(TAB_ROW_SEPARATOR)
  if (at < 0) return { taskId: rowId, tabId: null }
  return { taskId: rowId.slice(0, at), tabId: rowId.slice(at + TAB_ROW_SEPARATOR.length) }
}
