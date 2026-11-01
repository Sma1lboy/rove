/**
 * Pixel-smooth scrolling for the xterm pane. xterm moves by whole rows, so a touchpad that sends a few
 * pixels per event made the text sit still for two or three frames and then jump a row. The scroller keeps
 * the position as whole rows (handed to `term.scrollLines`, never to xterm's own scrollable, which drops a
 * sub-row delta whenever output lands mid-gesture) plus a fraction of a row that moves the screen layer by
 * CSS, so every frame shows the content where the fingers left it. The fraction is at most half a row, and
 * the band the offset uncovers at the pane's edge shows the neighbouring row of the buffer (`term-edge.ts`).
 */

import type { Terminal } from "@xterm/xterm"
import { createEdgeStrips } from "./term-edge.ts"
import { edgeCarry, glideStep, isWheelNotch, scrollStep, wheelDelta, wheelOwner } from "./term-scroll.ts"

/** Idle time after the last move before the screen eases back onto the row grid. */
const SETTLE_AFTER_MS = 140
const SETTLE_MS = 90
const FALLBACK_ROW_PX = 15

export interface SmoothScroll {
  /** Move the view by `lines` (negative = toward older output) at once. False when it sits against the buffer's edge. */
  by(lines: number): boolean
  /** Move the view by `lines` eased over a few frames: one notch of a mouse wheel. */
  glide(lines: number): void
  /** The gesture is over: ease the screen onto the row grid now instead of after a pause. */
  settle(): void
  /** Drop the offset and any glide in flight, with no animation. */
  reset(): void
  dispose(): void
}

/** `onMove` runs before each scroll of the local scrollback, as the pane's follow logic needs. */
export function createSmoothScroll(term: Terminal, onMove: () => void): SmoothScroll {
  let carry = 0
  let pending = 0
  let glideFrame = 0
  let glideAt = 0
  let settleTimer: number | null = null
  let transitionTimer: number | null = null
  let dirty = false

  const screen = () => term.element?.querySelector<HTMLElement>(".xterm-screen") ?? null
  const rowPx = () => {
    const el = screen()
    return el && term.rows > 0 ? el.clientHeight / term.rows || FALLBACK_ROW_PX : FALLBACK_ROW_PX
  }

  const edge = createEdgeStrips(term)
  const paint = () => {
    dirty = false
    const el = screen()
    if (!el) return
    const row = rowPx()
    el.style.transform = carry === 0 ? "" : `translateY(${-carry * row}px)`
    // The offset uncovers a band at one edge: the neighbouring row of the buffer fills it. While the screen eases
    // home the band closes with it.
    if (carry !== 0) edge.show(-carry * row, row)
    else if (el.style.transition !== "") edge.show(0, row)
    else edge.hide()
  }
  // xterm repaints a moved view in its next animation frame; the offset goes out in that same frame, from the
  // render itself, so the rows and the offset never show one frame apart (a row-sized hop back).
  const rendered = term.onRender(() => {
    if (dirty) paint()
    else edge.refresh()
  })
  const request = () => {
    dirty = true
    requestAnimationFrame(() => {
      if (dirty) paint()
    })
  }

  const endTransition = () => {
    if (transitionTimer !== null) window.clearTimeout(transitionTimer)
    transitionTimer = null
    const el = screen()
    if (el) el.style.transition = ""
    edge.transition("")
    if (carry === 0) edge.hide()
  }
  // A move that lands while the screen is still easing home starts from where it has got to.
  const takeOverTransition = () => {
    if (transitionTimer === null) return
    const el = screen()
    if (el) {
      const shown = new DOMMatrix(getComputedStyle(el).transform).m42
      carry = -shown / rowPx()
    }
    endTransition()
  }

  const armSettle = () => {
    if (settleTimer !== null) window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(settle, SETTLE_AFTER_MS)
  }
  function settle(): void {
    if (settleTimer !== null) window.clearTimeout(settleTimer)
    settleTimer = null
    if (carry === 0) return
    const el = screen()
    carry = 0
    if (!el) return
    el.style.transition = `transform ${SETTLE_MS}ms ease-out`
    edge.transition(`clip-path ${SETTLE_MS}ms ease-out`)
    paint()
    transitionTimer = window.setTimeout(endTransition, SETTLE_MS + 40)
  }

  const by = (lines: number): boolean => {
    if (lines === 0) return true
    takeOverTransition()
    const step = scrollStep(carry, lines)
    const buffer = term.buffer.active
    const from = buffer.viewportY
    if (step.lines !== 0) {
      onMove()
      term.scrollLines(step.lines)
    }
    const blocked = step.lines !== 0 && buffer.viewportY - from !== step.lines
    carry = blocked ? 0 : edgeCarry(step.carry, buffer)
    request()
    armSettle()
    return !blocked && carry === step.carry
  }

  const glideFrameTick = (now: number) => {
    glideFrame = 0
    const part = glideStep(pending, now - glideAt)
    glideAt = now
    pending -= part
    if (!by(part)) pending = 0
    if (pending !== 0) glideFrame = requestAnimationFrame(glideFrameTick)
  }

  const stopGlide = () => {
    pending = 0
    if (glideFrame) cancelAnimationFrame(glideFrame)
    glideFrame = 0
  }

  const reset = () => {
    stopGlide()
    if (settleTimer !== null) window.clearTimeout(settleTimer)
    settleTimer = null
    endTransition()
    carry = 0
    paint()
  }

  return {
    by,
    glide(lines) {
      // Against the buffer's edge there is nothing to ease toward.
      if (Math.sign(lines) !== Math.sign(pending)) pending = 0
      pending += lines
      if (!glideFrame) {
        glideAt = performance.now()
        glideFrame = requestAnimationFrame(glideFrameTick)
      }
    },
    settle,
    reset,
    dispose() {
      rendered.dispose()
      reset()
      edge.dispose()
    },
  }
}

/** A wheel the app does not take (normal screen, or mouse tracking without Shift) moves `scroll`; a notch glides. */
export function attachWheelScroll(el: HTMLElement, term: Terminal, scroll: SmoothScroll): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    const alternateScreen = term.buffer.active.type === "alternate"
    const mouseTracking = term.modes.mouseTrackingMode !== "none"
    if (wheelOwner({ alternateScreen, mouseTracking, shift: e.shiftKey }) === "app") {
      scroll.reset()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen")
    const cellHeight = screen && term.rows > 0 ? screen.clientHeight / term.rows : 0
    const delta = wheelDelta(e, cellHeight || FALLBACK_ROW_PX, term.rows)
    if (isWheelNotch(e)) scroll.glide(delta)
    else scroll.by(delta)
  }
  el.addEventListener("wheel", onWheel, { capture: true, passive: false })
  return () => el.removeEventListener("wheel", onWheel, { capture: true })
}
