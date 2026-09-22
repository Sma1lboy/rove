/**
 * Chat tab strip visibility (Settings → General → Terminal), kv-persisted.
 * One enum, not two booleans, since `hidden + hideSingle` means nothing:
 *
 *   - `always`      — renders for any tab count (a single tab's row still
 *                     carries the engine title and turn chip).
 *   - `multipleOnly`— hidden while a task has one tab.
 *   - `never`       — no strip.
 */

export const TAB_STRIP_MODE_KEY = "chat.tabStrip.mode"

export type TabStripMode = "always" | "multipleOnly" | "never"

export const TAB_STRIP_MODES: readonly TabStripMode[] = ["always", "multipleOnly", "never"]

/** Off by default: the sidebar tree already lists (and marks) every worktree's tabs. */
export const DEFAULT_TAB_STRIP_MODE: TabStripMode = "never"

/** Legacy boolean key — `true` meant "hide while a task has one tab". */
export const TAB_STRIP_HIDE_SINGLE_KEY = "chat.tabStrip.hideSingle"

/**
 * Effective mode; the legacy boolean applies until the new key is written.
 * Migrates on read only — rewriting would need a kv write from a render path.
 */
export function resolveTabStripMode(stored: unknown, legacyHideSingle: unknown): TabStripMode {
  if (typeof stored === "string" && (TAB_STRIP_MODES as readonly string[]).includes(stored)) {
    return stored as TabStripMode
  }
  if (legacyHideSingle === true) return "multipleOnly"
  if (legacyHideSingle === false) return "always"
  return DEFAULT_TAB_STRIP_MODE
}

/** Whether the strip renders, given the mode and how many tabs exist. */
export function tabStripVisible(mode: TabStripMode, tabCount: number): boolean {
  if (mode === "never") return false
  if (mode === "multipleOnly") return tabCount >= 2
  return true
}
