/**
 * Cells an AGENT tab row spends in the sidebar tree. `1` (default) keeps a
 * dozen worktrees × tabs fitting the rail; `2` adds a caption with the
 * session's model and reasoning level at about half the visible rows.
 * Shell, command and content tabs have no model and stay one cell.
 */

export const TAB_ROW_HEIGHT_KEY = "sidebar.tabRowHeight"

const TAB_ROW_HEIGHTS = [1, 2] as const
export type TabRowHeight = (typeof TAB_ROW_HEIGHTS)[number]

/** One cell — the density the tree was built around. */
export const DEFAULT_TAB_ROW_HEIGHT: TabRowHeight = 1

/** Coerce a persisted value; anything unrecognized → the default. */
export function normalizeTabRowHeight(raw: unknown): TabRowHeight {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw
  return TAB_ROW_HEIGHTS.includes(n as TabRowHeight) ? (n as TabRowHeight) : DEFAULT_TAB_ROW_HEIGHT
}
