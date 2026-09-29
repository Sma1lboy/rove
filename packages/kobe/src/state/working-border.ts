/**
 * How the workspace pane's border looks while the selected task works:
 * `flow` runs a colour gradient around it and names the task on the top
 * edge; `still` keeps the plain focus border.
 */

export const WORKING_BORDER_KEY = "appearance.workingBorder"

export const WORKING_BORDERS = ["flow", "still"] as const
export type WorkingBorder = (typeof WORKING_BORDERS)[number]

export const DEFAULT_WORKING_BORDER: WorkingBorder = "flow"

/** Coerce a persisted value; anything unrecognized → the default. */
export function normalizeWorkingBorder(raw: unknown): WorkingBorder {
  return WORKING_BORDERS.includes(raw as WorkingBorder) ? (raw as WorkingBorder) : DEFAULT_WORKING_BORDER
}
