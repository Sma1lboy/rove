import { ACCENT, COLS, ROWS, SUBTLE } from "@sma1lboy/rove-core/lib/celestial/grid.ts"
import { orbitFrame } from "@sma1lboy/rove-core/lib/celestial/orbit.ts"
import { cometFrame, ringsFrame } from "@sma1lboy/rove-core/lib/celestial/scenes.ts"
import { useEffect, useRef } from "react"
import { STARLING_FRAME } from "../ui/first-run.ts"
import { starlingPainter } from "./starling-paint.ts"
import type { SkyScene } from "./visits.ts"

const PITCH = 3
const DOT = 2
const TOKEN = ["", "--color-subtle", "--color-muted", "--color-ink", "--color-accent"] as const
const FRAMES = { orbit: orbitFrame, rings: ringsFrame, comet: cometFrame }
const STILL_T = 7

function paint(canvas: HTMLCanvasElement, cells: Uint8Array): void {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const width = Math.round(COLS * PITCH * dpr)
  if (canvas.width !== width) {
    canvas.width = width
    canvas.height = Math.round(ROWS * PITCH * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, COLS * PITCH, ROWS * PITCH)
  // Tokens are read per frame so a theme switch repaints in the new palette.
  const style = getComputedStyle(canvas)
  for (let ink = SUBTLE; ink <= ACCENT; ink++) {
    ctx.fillStyle = style.getPropertyValue(TOKEN[ink] ?? "") || style.color
    for (let i = 0; i < cells.length; i++)
      if (cells[i] === ink) ctx.fillRect((i % COLS) * PITCH, Math.floor(i / COLS) * PITCH, DOT, DOT)
  }
}

function planetPainter(canvas: HTMLCanvasElement, scene: keyof typeof FRAMES) {
  const cells = new Uint8Array(COLS * ROWS)
  const frame = FRAMES[scene] ?? orbitFrame
  return (time: number) => {
    frame(cells, time)
    paint(canvas, cells)
  }
}

export function CelestialPlate({ scene }: { scene: SkyScene }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const flock = scene === "starlings"
    const render = flock ? starlingPainter(canvas) : planetPainter(canvas, scene)
    const still = flock ? 8.7 : STILL_T
    let visible = false
    let timer = 0
    let elapsed = flock ? 0 : STILL_T
    let last = 0

    const draw = () => render(motion.matches ? still : elapsed)
    const tick = (now: number) => {
      timer = requestAnimationFrame(tick)
      if (now - last < 1000 / 24) return
      elapsed += (now - last) / 1000
      last = now
      draw()
    }
    const sync = () => {
      cancelAnimationFrame(timer)
      if (!visible || document.hidden) return
      draw()
      if (!motion.matches) {
        last = performance.now()
        timer = requestAnimationFrame(tick)
      }
    }
    const seen = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting
      sync()
    })
    seen.observe(canvas)
    // A motionless plate still follows a theme change.
    const theme = new MutationObserver(() => {
      if (visible && motion.matches) draw()
    })
    const size = flock
      ? new ResizeObserver(() => {
          if (visible && !document.hidden && motion.matches) draw()
        })
      : null
    size?.observe(canvas)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })
    motion.addEventListener("change", sync)
    document.addEventListener("visibilitychange", sync)
    return () => {
      cancelAnimationFrame(timer)
      seen.disconnect()
      size?.disconnect()
      theme.disconnect()
      motion.removeEventListener("change", sync)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [scene])

  return (
    <div
      aria-hidden="true"
      className={scene === "starlings" ? STARLING_FRAME : "mb-3 w-96 max-w-full shrink-0 narrow:w-72"}
    >
      <canvas
        key={scene}
        ref={ref}
        data-plate={scene}
        width={COLS * PITCH}
        height={ROWS * PITCH}
        className={
          scene === "starlings" ? "absolute inset-0 block h-full w-full text-muted" : "block h-auto w-full text-muted"
        }
      />
    </div>
  )
}
