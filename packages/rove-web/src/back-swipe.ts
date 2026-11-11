/**
 * Narrow layout: dragging the content panel right is the `‹ Tasks` button. The panel rides the finger
 * over the list, then slides off or springs back. Anywhere on the panel, not only its left edge, which
 * belongs to the browser's own history swipe.
 */

import { backToTasks, isNarrow, narrowPane } from "./layout.ts"
import { createStore } from "./store.ts"

const SLOP_PX = 10
const SETTLE_MS = 200
/** What a sideways drag already means something in: a caret, a dialog over the panel. */
const OWN = "input, textarea, select, [contenteditable], dialog"

/** A back swipe is on screen: the list shows under the panel (`narrow-back`). */
export const backSwiping = createStore(false)

/** Past the slop, only a mostly rightward drag takes the panel; anything else stays a scroll or a tap. */
export const startsBack = (dx: number, dy: number): boolean => dx > 0 && dx > Math.abs(dy)

/** Let go a third of the way across, or after a quick flick. */
export const completesBack = (dx: number, width: number, ms: number): boolean =>
  dx >= width / 3 || (dx >= 40 && ms < 250)

function scrollsSideways(from: Element): boolean {
  for (let el: Element | null = from; el; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  }
  return false
}

export function swipeBackToTasks(): void {
  let drag: { x: number; y: number; at: number; dx: number; on: boolean } | null = null
  const shell = () => document.querySelector<HTMLElement>(".app")

  const settle = (dx: number, back: boolean) => {
    const app = shell()
    const panel = app?.querySelector<HTMLElement>(":scope > main")
    const done = () => {
      if (back) backToTasks()
      backSwiping.set(false)
      app?.style.removeProperty("--back-x")
    }
    if (!app || !panel) return done()
    const to = back ? panel.offsetWidth : 0
    app.style.setProperty("--back-x", `${to}px`)
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    panel
      .animate(
        { translate: [`${dx}px`, `${to}px`] },
        { duration: still ? 0 : SETTLE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      )
      .finished.then(done, done)
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      const { target } = e
      // A panel still sliding is not grabbed again.
      const mine =
        !backSwiping.get() &&
        e.touches.length === 1 &&
        isNarrow() &&
        narrowPane.get() === "workspace" &&
        target instanceof Element &&
        !target.closest(OWN) &&
        !scrollsSideways(target)
      drag = mine ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: e.timeStamp, dx: 0, on: false } : null
    },
    { passive: true },
  )
  // Capture: once the panel moves, the terminal under the finger must not scroll with it.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!drag) return
      const dx = e.touches[0].clientX - drag.x
      if (!drag.on) {
        const dy = e.touches[0].clientY - drag.y
        if (Math.hypot(dx, dy) < SLOP_PX) return
        // A drag that selects text is a selection.
        if (e.touches.length !== 1 || !startsBack(dx, dy) || !document.getSelection()?.isCollapsed) {
          drag = null
          return
        }
        drag.on = true
        backSwiping.set(true)
      }
      e.preventDefault()
      e.stopPropagation()
      drag.dx = Math.max(0, dx)
      shell()?.style.setProperty("--back-x", `${drag.dx}px`)
    },
    { capture: true, passive: false },
  )
  const end = (e: TouchEvent) => {
    const last = drag
    drag = null
    if (!last?.on) return
    settle(last.dx, e.type === "touchend" && completesBack(last.dx, window.innerWidth, e.timeStamp - last.at))
  }
  document.addEventListener("touchend", end)
  document.addEventListener("touchcancel", end)
}
