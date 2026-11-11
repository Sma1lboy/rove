/**
 * Narrow layout: a finger dragged right across the content is the `‹ Tasks` button. Anywhere on the
 * panel, not only its left edge, which belongs to the browser's own history swipe.
 */

import { backToTasks, isNarrow, narrowPane } from "./layout.ts"

const MIN_PX = 64
/** What a sideways drag already means something in: a caret, a dialog over the panel. */
const OWN = "input, textarea, select, [contenteditable], dialog"

/** Rightward, and clearly more sideways than a scroll that drifted. */
export const isBackSwipe = (dx: number, dy: number): boolean => dx >= MIN_PX && dx > 2 * Math.abs(dy)

function scrollsSideways(from: Element): boolean {
  for (let el: Element | null = from; el; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  }
  return false
}

export function swipeBackToTasks(): void {
  let start: { x: number; y: number } | null = null
  document.addEventListener(
    "touchstart",
    (e) => {
      const { target } = e
      const mine =
        e.touches.length === 1 &&
        isNarrow() &&
        narrowPane.get() === "workspace" &&
        target instanceof Element &&
        !target.closest(OWN) &&
        !scrollsSideways(target)
      start = mine ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null
    },
    { passive: true },
  )
  document.addEventListener("touchend", (e) => {
    const from = start
    start = null
    const touch = e.changedTouches[0]
    // A drag that selected text is a selection.
    if (!from || !touch || e.touches.length > 0 || !document.getSelection()?.isCollapsed) return
    if (isBackSwipe(touch.clientX - from.x, touch.clientY - from.y)) backToTasks()
  })
  document.addEventListener("touchcancel", () => {
    start = null
  })
}
