/**
 * The task rail's persisted layout: folded or not, which strip, and a dragged
 * width. Read/written through the KV context so it shares the Settings
 * dialog's cache — two separate caches of state.json disagree until a reload.
 */

/** KV key for the fold. Absent = expanded. */
export const SIDEBAR_COLLAPSED_KEY = "sidebar.collapsed"

/** KV key for WHICH fold the strip renders. Absent = the jump digits. */
export const RAIL_FOLD_STYLE_KEY = "sidebar.foldStyle"

/** KV key for a dragged rail width. Absent or non-number = derive from the terminal. */
export const SIDEBAR_WIDTH_KEY = "sidebar.width"
