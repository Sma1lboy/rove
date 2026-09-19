/**
 * The task rail's persisted layout: whether it is folded to its strip, which
 * strip that is, and a width the user dragged it to.
 *
 * Persisted like zen's `zen.active`: folding is an intent about the layout you
 * want to work in, not a transient view state, so the workspace comes back the
 * way it was left. Read and written through the KV context so it shares the
 * Settings dialog's cache — two layers caching the same state.json separately
 * disagree until a reload.
 */

/** KV key for the fold. Absent = expanded. */
export const SIDEBAR_COLLAPSED_KEY = "sidebar.collapsed"

/** KV key for WHICH fold the strip renders. Absent = the jump digits. */
export const RAIL_FOLD_STYLE_KEY = "sidebar.foldStyle"

/**
 * KV key for a rail width the user dragged to. Absent (or a non-number, from
 * an older build or a hand-edited state.json) = follow the width derived from
 * the terminal.
 */
export const SIDEBAR_WIDTH_KEY = "sidebar.width"
