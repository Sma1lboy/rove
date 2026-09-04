/**
 * Zen mode's two persisted state.json keys. Zen collapses the workspace to
 * the engine pane (hiding Files and the terminal pane, and the Tasks rail too
 * when `zen.keepTasks` is off).
 *
 * This module holds only the KEYS. The readers and writers are the KV context
 * (`tui-react/workspace/use-zen-mode.ts`, `settings-dialog/use-settings-prefs.ts`),
 * which shares the Settings dialog's cache — a second, uncached reader here
 * would disagree with it until a reload, so there deliberately is none.
 *
 * Defaults: keep-tasks ON (so the prefix chord is always reachable to leave
 * zen again), active OFF.
 */

export const ZEN_KEEP_TASKS_KEY = "zen.keepTasks"

export const ZEN_ACTIVE_KEY = "zen.active"
