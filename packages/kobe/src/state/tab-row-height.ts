/**
 * How many cells an AGENT tab row spends in the sidebar tree.
 *
 * `1` is the default and the rail's own grammar: every row in the tree is one
 * cell, because a dozen worktrees × their tabs have to fit a rail a few dozen
 * cells tall. `2` buys a caption line under the tab title carrying the model
 * and reasoning level that session launches with — the one fact that
 * otherwise takes opening a dialog to read — and costs roughly half the rows
 * you can see at once. Which trade is right depends on how many tasks the
 * reader keeps open, so it is theirs to make.
 *
 * Only agent tabs are affected either way: shell, command and content tabs
 * have no model, so they stay one cell at both settings.
 */

export const TAB_ROW_HEIGHT_KEY = "sidebar.tabRowHeight"

const TAB_ROW_HEIGHTS = [1, 2] as const
export type TabRowHeight = (typeof TAB_ROW_HEIGHTS)[number]

/** One cell — the density the tree was built around. */
export const DEFAULT_TAB_ROW_HEIGHT: TabRowHeight = 1

/** Coerce a persisted value; anything unrecognized falls back to the default
 *  rather than leaving the tree at a height nothing renders for. */
export function normalizeTabRowHeight(raw: unknown): TabRowHeight {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw
  return TAB_ROW_HEIGHTS.includes(n as TabRowHeight) ? (n as TabRowHeight) : DEFAULT_TAB_ROW_HEIGHT
}
