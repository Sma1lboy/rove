/**
 * What marks a task row: the engine mark at the left carrying the state (`engine`), the mark in its brand colours
 * with the 3×3 dots at the right for the state (`both`), or the dots alone (`dots`). Kept per browser, as the grouping.
 */
import { createStore } from "./store.ts"

export const STATUS_MARKS = ["engine", "both", "dots"] as const
export type StatusMarkStyle = (typeof STATUS_MARKS)[number]

export const STATUS_MARK_KEY = "rove.statusMark"

export const statusMarkStyle = createStore<StatusMarkStyle>(
  STATUS_MARKS.find((style) => style === localStorage.getItem(STATUS_MARK_KEY)) ?? "engine",
)

export function setStatusMarkStyle(next: StatusMarkStyle): void {
  statusMarkStyle.set(next)
  localStorage.setItem(STATUS_MARK_KEY, next)
}
