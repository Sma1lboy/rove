/**
 * The phone shows the PTY at the size another viewer gave it (`term-mount.ts`) and scales that screen into its
 * box: fitted to the width by default; a pinch or a double tap goes to the readable size, where a drag pans.
 * A CSS transform on `.xterm`: the renderer keeps drawing at the real font size, so zoomed-in text stays crisp.
 */

import type { Terminal } from "@xterm/xterm"

/** The phone's own font size (`termFontSize`) at scale 1. */
const READABLE = 1
const MAX = 2.5
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
const TAP_SLOP_PX = 6

export interface TermZoom {
  /** A drag pans the screen before it scrolls (`term-touch.ts`). */
  active(): boolean
  /** Pans by a drag's delta; returns the part of `dy` past the screen's edge, for the scrollback. */
  pan(dx: number, dy: number): number
  /** Back to the screen's bottom edge (jump to bottom, typing). */
  toBottom(): void
  /** Re-measures; `on` = the screen is the PTY's size, not the box's. */
  layout(on: boolean): void
  dispose(): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function attachZoom(el: HTMLElement, term: Terminal): TermZoom {
  let on = false
  /** null = fitted to the width, following the box. */
  let zoom: number | null = null
  let x = 0
  let y = 0
  let stick = true

  const size = () => ({ w: term.element?.offsetWidth ?? 0, h: term.element?.offsetHeight ?? 0 })
  const fitScale = () => {
    const { w } = size()
    return w > 0 ? Math.min(READABLE, el.clientWidth / w) : READABLE
  }
  const scale = () => zoom ?? fitScale()
  const apply = () => {
    const box = term.element
    if (!box) return
    if (!on) {
      box.style.transform = box.style.transformOrigin = box.style.width = box.style.height = ""
      return
    }
    box.style.width = box.style.height = "fit-content"
    box.style.transformOrigin = "0 0"
    const s = scale()
    const { w, h } = size()
    const maxX = Math.max(0, w * s - el.clientWidth)
    const maxY = Math.max(0, h * s - el.clientHeight)
    x = clamp(x, 0, maxX)
    y = clamp(stick ? maxY : y, 0, maxY)
    stick = y >= maxY - 0.5
    box.style.transform = `translate(${-x}px, ${-y}px) scale(${s})`
  }
  /** Zooms to `next`, keeping the screen point under (cx, cy) in the box where it is. */
  const zoomAt = (next: number, cx: number, cy: number) => {
    const s = scale()
    const fit = fitScale()
    const z = clamp(next, fit, MAX)
    zoom = z - fit < 0.01 ? null : z
    x = ((cx + x) / s) * z - cx
    y = ((cy + y) / s) * z - cy
    stick = false
    apply()
  }

  let pinch: { d: number; s: number } | null = null
  let tap: { x: number; y: number; moved: boolean } | null = null
  let lastTap: { x: number; y: number; at: number } | null = null
  const local = (t: Touch) => {
    const r = el.getBoundingClientRect()
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }
  const spread = (e: TouchEvent) => {
    const [a, b] = [local(e.touches[0]), local(e.touches[1])]
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
  }
  const onStart = (e: TouchEvent) => {
    if (!on) return
    if (e.touches.length === 2) {
      pinch = { d: spread(e).d, s: scale() }
      tap = null
    } else if (e.touches.length === 1) tap = { ...local(e.touches[0]), moved: false }
  }
  const onMove = (e: TouchEvent) => {
    if (!on) return
    if (pinch && e.touches.length === 2) {
      e.preventDefault()
      const { d, cx, cy } = spread(e)
      if (pinch.d > 0) zoomAt((pinch.s * d) / pinch.d, cx, cy)
      return
    }
    if (tap && e.touches.length === 1) {
      const p = local(e.touches[0])
      if (Math.hypot(p.x - tap.x, p.y - tap.y) > TAP_SLOP_PX) tap.moved = true
    }
  }
  const onEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) pinch = null
    if (!on || !tap || tap.moved || e.touches.length > 0) {
      if (e.touches.length === 0) tap = null
      return
    }
    const now = performance.now()
    const here = tap
    tap = null
    if (
      lastTap &&
      now - lastTap.at < DOUBLE_TAP_MS &&
      Math.hypot(here.x - lastTap.x, here.y - lastTap.y) < DOUBLE_TAP_PX
    ) {
      lastTap = null
      e.preventDefault()
      zoomAt(zoom === null ? READABLE : fitScale(), here.x, here.y)
    } else lastTap = { x: here.x, y: here.y, at: now }
  }
  el.addEventListener("touchstart", onStart, { capture: true, passive: true })
  el.addEventListener("touchmove", onMove, { capture: true, passive: false })
  el.addEventListener("touchend", onEnd, { capture: true, passive: false })
  el.addEventListener("touchcancel", onEnd, { capture: true, passive: false })
  const resized = term.onResize(apply)

  return {
    active: () => on,
    pan(dx, dy) {
      if (!on) return dy
      const before = y
      x += dx
      y += dy
      stick = false
      apply()
      const used = y - before
      return dy - used
    },
    toBottom() {
      stick = true
      apply()
    },
    layout(next) {
      on = next
      apply()
    },
    dispose() {
      el.removeEventListener("touchstart", onStart, { capture: true })
      el.removeEventListener("touchmove", onMove, { capture: true })
      el.removeEventListener("touchend", onEnd, { capture: true })
      el.removeEventListener("touchcancel", onEnd, { capture: true })
      resized.dispose()
    },
  }
}
