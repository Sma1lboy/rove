/**
 * Narrow layout: dragging a panel right is its back button. The content panel goes back to the task list;
 * a full-screen dialog names its own panels with `backPanel`. The panel rides the finger over what is
 * under it, then slides off or springs back. Anywhere on the panel, not only its left edge, which
 * belongs to the browser's own history swipe.
 */

import { backToTasks, isNarrow, narrowPane } from "./layout.ts"
import { createStore } from "./store.ts"

const SLOP_PX = 10
const SETTLE_MS = 200
/** What a sideways drag already means something in: a caret. */
const OWN = "input, textarea, select, [contenteditable]"
const PANEL = "[data-back-panel]"

/** A back swipe is on screen, and whose: the app's content panel (`narrow-back`) or a `backPanel`. */
export const backSwiping = createStore<"app" | "panel" | null>(null)

/** A ref for a panel a back swipe drags; `onBack` runs once it has slid off. */
export const backPanel = (onBack: () => void) => (el: HTMLElement | null) => {
  if (!el) return
  el.dataset.backPanel = ""
  el.addEventListener("backswipe", onBack)
  return () => {
    delete el.dataset.backPanel
    el.removeEventListener("backswipe", onBack)
  }
}

/** The panel a touch on `target` would drag: the nearest `backPanel`, else the content panel when nothing covers it. */
function panelFor(target: Element): HTMLElement | null {
  const marked = target.closest<HTMLElement>(PANEL)
  if (marked) return marked
  if (target.closest("dialog") || narrowPane.get() !== "workspace") return null
  return document.querySelector<HTMLElement>(".app > main")
}

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
  let drag: { panel: HTMLElement; x: number; y: number; at: number; dx: number; on: boolean } | null = null

  const settle = (panel: HTMLElement, dx: number, back: boolean) => {
    const done = () => {
      if (!back) panel.style.removeProperty("--back-x")
      else if (panel.matches(PANEL)) panel.dispatchEvent(new Event("backswipe"))
      else backToTasks()
      backSwiping.set(null)
    }
    // Gone back, the panel keeps its place off screen: a dialog still fades out there.
    const to = back ? panel.offsetWidth : 0
    panel.style.setProperty("--back-x", `${to}px`)
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
      drag = null
      // A panel still sliding is not grabbed again.
      if (backSwiping.get() || e.touches.length !== 1 || !isNarrow() || !(target instanceof Element)) return
      if (target.closest(OWN) || scrollsSideways(target)) return
      const panel = panelFor(target)
      if (panel) drag = { panel, x: e.touches[0].clientX, y: e.touches[0].clientY, at: e.timeStamp, dx: 0, on: false }
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
        backSwiping.set(drag.panel.matches(PANEL) ? "panel" : "app")
      }
      e.preventDefault()
      e.stopPropagation()
      drag.dx = Math.max(0, dx)
      drag.panel.style.setProperty("--back-x", `${drag.dx}px`)
    },
    { capture: true, passive: false },
  )
  const end = (e: TouchEvent) => {
    const last = drag
    drag = null
    if (!last?.on) return
    const back = e.type === "touchend" && completesBack(last.dx, window.innerWidth, e.timeStamp - last.at)
    settle(last.panel, last.dx, back)
  }
  document.addEventListener("touchend", end)
  document.addEventListener("touchcancel", end)
}
