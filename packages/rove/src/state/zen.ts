/**
 * Zen mode's state.json key. Zen hides the Files pane; the Tasks rail always
 * stays — it carries the way out of zen. ON when unset: Files is opt-in.
 *
 * Key only: reads/writes go through the KV context so they share the Settings
 * dialog's cache; a second uncached reader would disagree until a reload.
 */

export const ZEN_ACTIVE_KEY = "zen.active"
export const ZEN_DEFAULT = true

// An old state.json may carry an unused `zen.keepTasks`; unknown keys are ignored.
