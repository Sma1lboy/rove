/**
 * The first-run picture (`ascii-flow.ts`) in a `<pre>`: two stacked layers (quiet trails, accent
 * heads), written by text node through refs, never through React state. It plays at 12 fps while
 * the page is visible and motion is allowed, and stops when it unmounts; under reduced motion it
 * draws one frame and never schedules another. Width follows the container in whole characters;
 * height is fixed, so nothing around it moves as frames change.
 */

import { useEffect, useRef } from "react"
import {
  FLOW_FPS,
  FLOW_MAX_COLS,
  FLOW_MIN_COLS,
  FLOW_REST_TICK,
  FLOW_ROWS,
  type FlowFrame,
  frameAt,
} from "./ascii-flow.ts"

const LINE_HEIGHT = 1.3
const PROBE = "0000000000"
const FRAME_MS = 1000 / FLOW_FPS
const LAYER = "col-start-1 row-start-1 m-0 whitespace-pre font-[inherit] leading-[inherit]"

export function AsciiFlow() {
  const box = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLSpanElement>(null)
  const base = useRef<HTMLPreElement>(null)
  const accent = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = box.current
    const ruler = probe.current
    const lower = base.current
    const upper = accent.current
    if (!el || !ruler || !lower || !upper) return
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)")
    let cols = FLOW_MIN_COLS
    let tick = FLOW_REST_TICK
    let raf = 0
    let anchor = 0
    let anchorTick = 0
    let last = -1
    // Off screen (the narrow layout keeps the rail mounted, hidden, behind a page) it does not run.
    let shown = true

    const draw = () => {
      const frame: FlowFrame = frameAt(tick, cols)
      lower.textContent = frame.base
      upper.textContent = frame.accent
    }
    const measure = () => {
      const cell = ruler.getBoundingClientRect().width / PROBE.length
      if (cell > 0) cols = Math.min(FLOW_MAX_COLS, Math.max(FLOW_MIN_COLS, Math.floor(el.clientWidth / cell)))
      draw()
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const next = anchorTick + Math.floor((now - anchor) / FRAME_MS)
      if (next === last) return
      last = next
      tick = next
      draw()
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const sync = () => {
      stop()
      if (calm.matches) {
        tick = FLOW_REST_TICK
        draw()
      } else if (shown && document.visibilityState === "visible") {
        anchor = performance.now()
        anchorTick = tick
        last = -1
        raf = requestAnimationFrame(frame)
      }
    }

    const resize = new ResizeObserver(measure)
    resize.observe(el)
    measure()
    sync()
    const seen = new IntersectionObserver((entries) => {
      shown = entries[entries.length - 1]?.isIntersecting ?? true
      sync()
    })
    seen.observe(el)
    calm.addEventListener("change", sync)
    document.addEventListener("visibilitychange", sync)
    return () => {
      stop()
      resize.disconnect()
      seen.disconnect()
      calm.removeEventListener("change", sync)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [])

  return (
    <div
      ref={box}
      aria-hidden="true"
      data-field="first-run-art"
      className="relative grid w-full select-none overflow-hidden font-mono text-(length:--fs-body) text-subtle [contain:layout_paint]"
      style={{ height: `${FLOW_ROWS * LINE_HEIGHT}em`, lineHeight: LINE_HEIGHT }}
    >
      <span ref={probe} className="invisible absolute top-0 left-0 whitespace-pre">
        {PROBE}
      </span>
      <pre ref={base} className={LAYER} />
      <pre ref={accent} className={`${LAYER} text-accent`} />
    </div>
  )
}
