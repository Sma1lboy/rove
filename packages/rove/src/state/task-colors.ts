/**
 * Per-task colour: `on` gives every task its own hue (the working border
 * flows in the selected task's colour, sidebar rows carry a mark); `off`
 * keeps the single theme accent.
 */

export const TASK_COLORS_KEY = "appearance.taskColors"

export const TASK_COLORS = ["on", "off"] as const
export type TaskColors = (typeof TASK_COLORS)[number]

export const DEFAULT_TASK_COLORS: TaskColors = "on"

/** Coerce a persisted value; anything unrecognized → the default. */
export function normalizeTaskColors(raw: unknown): TaskColors {
  return TASK_COLORS.includes(raw as TaskColors) ? (raw as TaskColors) : DEFAULT_TASK_COLORS
}
