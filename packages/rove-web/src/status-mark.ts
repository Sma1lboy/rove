/** What says a task row's state: its engine mark at the left, or the 3×3 dots at the right. Kept per browser, as the grouping. */
import { createStore } from "./store.ts"

export const STATUS_MARKS = ["engine", "dots"] as const
export type StatusMarkStyle = (typeof STATUS_MARKS)[number]

const KEY = "rove.statusMark"

export const statusMarkStyle = createStore<StatusMarkStyle>(
  STATUS_MARKS.find((style) => style === localStorage.getItem(KEY)) ?? "engine",
)

export function setStatusMarkStyle(next: StatusMarkStyle): void {
  statusMarkStyle.set(next)
  localStorage.setItem(KEY, next)
}
