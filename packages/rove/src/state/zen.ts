/**
 * Zen mode's state.json key (default OFF). Zen hides Files and the terminal
 * pane; the Tasks rail always stays — it carries the way out of zen.
 *
 * Key only: reads/writes go through the KV context so they share the Settings
 * dialog's cache; a second uncached reader would disagree until a reload.
 */

export const ZEN_ACTIVE_KEY = "zen.active"

// An old state.json may carry an unused `zen.keepTasks`; unknown keys are ignored.
