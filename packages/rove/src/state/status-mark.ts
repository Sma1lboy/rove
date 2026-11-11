/**
 * What marks a task row in the web rail: the engine mark carrying the state (`engine`), the mark in its brand
 * colours with the dot mark for the state (`both`), or the dot mark alone (`dots`, the look before engine marks).
 */

export const STATUS_MARK_KEY = "appearance.statusMark"

export const STATUS_MARKS = ["engine", "both", "dots"] as const
export type StatusMarkStyle = (typeof STATUS_MARKS)[number]

export const DEFAULT_STATUS_MARK: StatusMarkStyle = "engine"

/** Coerce a persisted value; anything unrecognized → the default. */
export function normalizeStatusMark(raw: unknown): StatusMarkStyle {
  return STATUS_MARKS.includes(raw as StatusMarkStyle) ? (raw as StatusMarkStyle) : DEFAULT_STATUS_MARK
}

/** Set once any client has shown (or had no reason to show) the notice that task rows changed. */
export const STATUS_MARK_NOTICE_KEY = "hints.statusMark.seen"
