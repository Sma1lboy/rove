/**
 * The phone shows the PTY at the size another viewer gave it (`term-mount.ts`) at a readable font, from the left
 * edge and the bottom, where a drag pans across wide lines. A double tap or a pinch out fits the whole width
 * (whole-device-pixel cells); a double tap there goes back. A grid shorter than the box sits at its bottom, so the
 * latest output stays by the composer. Only the pan is a CSS transform (a translate, which xterm's mouse mapping
 * reads through `getBoundingClientRect`); every zoom level is drawn at its real font size.
 */

import type { Terminal } from "@xterm/xterm"
import { termFontSize } from "./term-look.ts"

const MAX_PX = 24
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
const TAP_SLOP_PX = 6
/** Output stops pulling the view to the cursor for this long after the user pans or zooms. */
const USER_HOLD_MS = 3000

export interface TermZoom {
  /** A drag pans the screen before it scrolls (`term-touch.ts`). */
  active(): boolean
  /** Pans by a drag's delta; returns the part of `dy` past the screen's edge, for the scrollback. */
  pan(dx: number, dy: number): number
  /** Back to the screen's bottom edge (jump to bottom, typing). */
  toBottom(): void
  /** Pans the cursor's cell into view; `fromOutput` yields to a user who just moved the view. */
  revealCursor(fromOutput?: boolean): void
  /** Sets the font for `on` (the grid is the PTY's) or back to the box's own; then re-places the screen. */
  layout(on: boolean): void
  dispose(): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** `fontSize` × this = one cell's advance, from xterm's own measure (the same private read `term-fit.ts` makes). */
function cellAdvance(term: Terminal): number {
  const measured = (term as unknown as { _core?: { _charSizeService?: { width?: number } } })._core?._charSizeService
    ?.width
  const px = Number(term.options.fontSize)
  return measured && px > 0 ? measured / px : 0.6
}

/** The largest font whose `cols` cells fit `width` CSS px: xterm floors a cell to whole device pixels. */
export function fitFontSize(width: number, cols: number, ratio: number, perPx: number): number {
  const cell = Math.floor((width * ratio) / cols)
  return Math.max(1, (cell + 0.5) / (perPx * ratio))
}

/** A session's last zoom (by stream), so reopening it keeps the reader's choice. */
const remembered = new Map<string, Zoom>()
/** "fit" = the whole width in the box; null = readable (the box's own font); a number = pinched to it. */
type Zoom = number | "fit" | null

export function attachZoom(el: HTMLElement, term: Terminal, key: string): TermZoom {
  let on = false
  let zoomPx: Zoom = remembered.get(key) ?? null
  let x = 0
  let y = 0
  let stick = true
  let userAt = 0

  const screen = () => term.element?.querySelector<HTMLElement>(".xterm-screen") ?? null
  const room = () => {
    const box = term.element
    const style = box ? getComputedStyle(box) : null
    const pad = (side: string) => Number.parseFloat(style?.getPropertyValue(`padding-${side}`) ?? "") || 0
    return { w: el.clientWidth - pad("left") - pad("right"), h: el.clientHeight }
  }
  const fitPx = () =>
    Math.min(termFontSize(), fitFontSize(room().w, term.cols, window.devicePixelRatio || 1, cellAdvance(term)))
  /** Never under the fit: a PTY narrow enough to read whole has nothing to pan. */
  const wantPx = () => {
    const fit = fitPx()
    return zoomPx === "fit" ? fit : Math.max(fit, zoomPx ?? termFontSize())
  }
  const setZoom = (next: Zoom) => {
    zoomPx = next
    remembered.set(key, next)
  }
  const setFont = (px: number) => {
    if (term.options.fontSize === px) return
    term.options.fontSize = px
    // xterm re-sizes its scroll area on a buffer resize or scroll, not a new font: until then a swipe reads the old
    // row height and the scrollback does not move. Forget the last scroll target so the sync re-places it.
    const view = (term as unknown as { _core?: { _viewport?: { _latestYDisp?: number; queueSync(): void } } })._core
      ?._viewport
    if (!view) return
    view._latestYDisp = undefined
    view.queueSync()
  }
  const place = () => {
    const box = term.element
    if (!box) return
    if (!on) {
      box.style.transform = ""
      box.style.removeProperty("--pan")
      return
    }
    const s = screen()
    const { w, h } = room()
    const maxX = Math.max(0, (s?.offsetWidth ?? 0) - w)
    // Negative when the grid is shorter than the box: it then sits on the box's bottom edge, never above a dead band.
    const maxY = (s?.offsetHeight ?? 0) - h
    x = clamp(x, 0, maxX)
    y = maxY <= 0 ? maxY : clamp(stick ? maxY : y, 0, maxY)
    stick = y >= maxY - 0.5
    box.style.transform = x || y ? `translate(${-x}px, ${-y}px)` : ""
    box.style.setProperty("--pan", `${x}px ${y}px`)
  }
  /** Zooms to `px`, keeping the content under (cx, cy) in the box where it is. */
  const zoomAt = (px: number, cx: number, cy: number) => {
    const before = Number(term.options.fontSize)
    setZoom(px <= fitPx() + 0.25 ? "fit" : Math.min(MAX_PX, px))
    const next = wantPx()
    setFont(next)
    const ratio = next / before
    x = (x + cx) * ratio - cx
    y = (y + cy) * ratio - cy
    // A view on the latest output stays on it: only the sideways anchor follows the fingers.
    userAt = performance.now()
    place()
  }
  const revealCursor = (fromOutput = false) => {
    const s = screen()
    if (!on || !s || term.cols <= 0 || term.rows <= 0) return
    if (fromOutput && performance.now() - userAt < USER_HOLD_MS) return
    const { w, h } = room()
    const cellW = s.offsetWidth / term.cols
    const cellH = s.offsetHeight / term.rows
    const cx = term.buffer.active.cursorX * cellW
    const cy = term.buffer.active.cursorY * cellH
    const before = [x, y]
    if (cx < x || cx + cellW > x + w) x = cx - w / 2
    if (cy < y) y = cy
    else if (cy + cellH > y + h) y = cy + cellH - h
    if (x === before[0] && y === before[1]) return
    stick = false
    place()
  }

  let pinch: { d: number; px: number } | null = null
  let frame = 0
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
      pinch = { d: spread(e).d, px: Number(term.options.fontSize) }
      tap = null
    } else if (e.touches.length === 1) tap = { ...local(e.touches[0]), moved: false }
  }
  const onMove = (e: TouchEvent) => {
    if (!on) return
    if (pinch && e.touches.length === 2) {
      e.preventDefault()
      const { d, cx, cy } = spread(e)
      if (pinch.d <= 0) return
      // Half-pixel steps, at most one per frame: each new size draws a new glyph atlas.
      const px = Math.round(((pinch.px * d) / pinch.d) * 2) / 2
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (px !== term.options.fontSize) zoomAt(px, cx, cy)
      })
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
    const again =
      lastTap && now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(here.x - lastTap.x, here.y - lastTap.y) < DOUBLE_TAP_PX
    lastTap = again ? null : { x: here.x, y: here.y, at: now }
    if (!again) return
    e.preventDefault()
    zoomAt(Number(term.options.fontSize) > fitPx() + 0.25 ? 0 : termFontSize(), here.x, here.y)
  }
  el.addEventListener("touchstart", onStart, { capture: true, passive: true })
  el.addEventListener("touchmove", onMove, { capture: true, passive: false })
  el.addEventListener("touchend", onEnd, { capture: true, passive: false })
  el.addEventListener("touchcancel", onEnd, { capture: true, passive: false })
  const resized = term.onResize(place)

  return {
    active: () => on,
    pan(dx, dy) {
      if (!on) return dy
      const before = y
      x += dx
      y += dy
      stick = false
      userAt = performance.now()
      place()
      return dy - (y - before)
    },
    toBottom() {
      stick = true
      place()
    },
    revealCursor,
    layout(next) {
      on = next
      setFont(on ? wantPx() : termFontSize())
      place()
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame)
      el.removeEventListener("touchstart", onStart, { capture: true })
      el.removeEventListener("touchmove", onMove, { capture: true })
      el.removeEventListener("touchend", onEnd, { capture: true })
      el.removeEventListener("touchcancel", onEnd, { capture: true })
      resized.dispose()
    },
  }
}
