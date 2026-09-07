/**
 * Zen mode's persisted state.json key. Zen collapses the workspace to the
 * engine pane, hiding Files and the terminal pane; the Tasks rail always
 * stays, because it carries the affordance for leaving zen again.
 *
 * This module holds only the KEY. The readers and writers are the KV context
 * (`tui-react/workspace/use-zen-mode.ts`, `settings-dialog/use-settings-prefs.ts`),
 * which shares the Settings dialog's cache — a second, uncached reader here
 * would disagree with it until a reload, so there deliberately is none.
 *
 * Default: OFF.
 */

export const ZEN_ACTIVE_KEY = "zen.active"

/**
 * Legacy. Nothing reads or writes it: the rail is unconditional, so the
 * checkbox that wrote this key was removed rather than left promising a
 * layout change it never made. Named here so the value someone finds in an
 * old hand-edited state.json has an explanation; unknown keys are ignored.
 */
export const ZEN_KEEP_TASKS_KEY = "zen.keepTasks"
