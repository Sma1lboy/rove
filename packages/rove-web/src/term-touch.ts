/**
 * A finger swipe is a wheel: xterm takes no touch scrolling, so a phone could not leave the bottom
 * of the scrollback. The content follows the finger pixel by pixel (`term-smooth.ts`); on the
 * alternate screen the swipe goes to the app as a wheel event, as a mouse wheel does. A tap (no
 * move past the slop) stays a tap, so focusing the terminal still opens the keyboard.
 */

import type { Terminal } from "@xterm/xterm"
import { wheelOwner } from "./term-scroll.ts"
import type { SmoothScroll } from "./term-smooth.ts"

const TAP_SLOP_PX = 6

/** Listens on `el`, moving the local scrollback through `scroll`. Returns the detach. */
export function attachTouchScroll(el: HTMLElement, term: Terminal, scroll: SmoothScroll): () => void {
  let touchY: number | null = null
  let swiping = false
  const onStart = (e: TouchEvent) => {
    touchY = e.touches.length === 1 ? e.touches[0].clientY : null
    swiping = false
  }
  const onMove = (e: TouchEvent) => {
    if (touchY === null || e.touches.length !== 1) return
    const { clientX, clientY } = e.touches[0]
    if (!swiping && Math.abs(clientY - touchY) < TAP_SLOP_PX) return
    swiping = true
    e.preventDefault()
    const deltaY = touchY - clientY
    touchY = clientY
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen")
    const alternateScreen = term.buffer.active.type === "alternate"
    const mouseTracking = term.modes.mouseTrackingMode !== "none"
    if (wheelOwner({ alternateScreen, mouseTracking, shift: false }) === "app") {
      screen?.dispatchEvent(
        new WheelEvent("wheel", { deltaY, deltaMode: 0, clientX, clientY, bubbles: true, cancelable: true }),
      )
      return
    }
    const cellHeight = screen && term.rows > 0 ? screen.clientHeight / term.rows : 0
    scroll.by(deltaY / (cellHeight || 15))
  }
  const onEnd = () => {
    touchY = null
    scroll.settle()
  }
  el.addEventListener("touchstart", onStart, { passive: true })
  el.addEventListener("touchmove", onMove, { passive: false })
  el.addEventListener("touchend", onEnd)
  el.addEventListener("touchcancel", onEnd)
  return () => {
    el.removeEventListener("touchstart", onStart)
    el.removeEventListener("touchmove", onMove)
    el.removeEventListener("touchend", onEnd)
    el.removeEventListener("touchcancel", onEnd)
  }
}
