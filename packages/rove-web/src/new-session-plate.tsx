/**
 * The New session page's plate: a lit, spinning planet sampled onto a dot grid
 * with ordered dither, and a few satellites trailing along tilted orbits — one
 * hub, many sessions. Decoration only: hidden from assistive tech, idle in a
 * hidden tab, and a still frame under `prefers-reduced-motion`.
 */

import { useEffect, useRef } from "react"

const COLS = 128
const ROWS = 80
/** CSS px per cell and per dot; the canvas is `w-96` = COLS cells wide. */
const PITCH = 3
const DOT = 2
const CX = COLS / 2
const CY = ROWS / 2
/** Planet radius in cells. */
const R = 25
const FRAME_MS = 1000 / 30
const STILL_T = 7

const NONE = 0
const SUBTLE = 1
const MUTED = 2
const INK = 3
const ACCENT = 4
const TOKEN = ["", "--color-subtle", "--color-muted", "--color-ink", "--color-accent"] as const

/** 4×4 Bayer thresholds in (0, 1): a cell is lit when its brightness clears its threshold. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16)
const threshold = (col: number, row: number) => BAYER[(row & 3) * 4 + (col & 3)] ?? 1

/** radius in planet radii, `lift` = how open the ellipse reads, `roll` = its tilt on screen. */
const ORBITS = [
  { radius: 1.55, lift: 0.3, roll: -0.42, speed: 0.9, phase: 0.4, ink: ACCENT },
  { radius: 1.95, lift: 0.22, roll: 0.3, speed: -0.55, phase: 2.6, ink: INK },
  { radius: 2.4, lift: 0.36, roll: -0.12, speed: 0.38, phase: 4.4, ink: INK },
] as const
/** Trail length in radians of orbit. */
const TRAIL = 1.9

/** Stars as (col, row, twinkle phase). */
const STARS = [
  [6, 9, 0.3],
  [22, 68, 2.1],
  [37, 4, 4.0],
  [95, 7, 1.2],
  [118, 20, 3.3],
  [122, 62, 5.1],
  [11, 40, 2.8],
  [83, 75, 0.9],
] as const

/** Fills `cells` (COLS × ROWS inks) with the scene at `t` seconds. */
export function plateFrame(cells: Uint8Array, t: number): void {
  cells.fill(NONE)
  const put = (col: number, row: number, ink: number) => {
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) cells[row * COLS + col] = ink
  }

  for (const [col, row, phase] of STARS) if (Math.sin(t * 0.8 + phase) > -0.5) put(col, row, SUBTLE)

  // The planet: Lambert light on a sphere whose banded surface spins under it.
  const lx = -0.55 + 0.25 * Math.sin(t * 0.3)
  const ly = -0.5
  const lz = 0.67
  const ll = Math.hypot(lx, ly, lz)
  const spin = t * 0.35
  const sinS = Math.sin(spin)
  const cosS = Math.cos(spin)
  const TILT = 0.4
  const sinT = Math.sin(TILT)
  const cosT = Math.cos(TILT)
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = (col + 0.5 - CX) / R
      const y = (row + 0.5 - CY) / R
      const r2 = x * x + y * y
      if (r2 >= 1) continue
      const z = Math.sqrt(1 - r2)
      const light = Math.max(0, (x * lx + y * ly + z * lz) / ll)
      // Surface coordinates: tilt the axis, then spin about it.
      const xt = x * cosT + y * sinT
      const yt = y * cosT - x * sinT
      const lon = Math.atan2(xt * cosS + z * sinS, z * cosS - xt * sinS)
      const lat = Math.asin(Math.max(-1, Math.min(1, yt)))
      const band = 0.5 + 0.5 * Math.sin(lat * 9 + 1.3 * Math.sin(lon * 2 + lat * 3))
      if (light * (0.5 + 0.5 * band) > threshold(col, row)) put(col, row, light > 0.8 ? INK : MUTED)
    }
  }

  // Orbits: a faint dotted ellipse, then a satellite whose trail dithers out behind it.
  for (const orbit of ORBITS) {
    const sinR = Math.sin(orbit.roll)
    const cosR = Math.cos(orbit.roll)
    /** Cell under orbit angle `phi`, or null where the planet hides it. */
    const at = (phi: number): readonly [number, number] | null => {
      const ox = orbit.radius * Math.cos(phi)
      const depth = orbit.radius * Math.sin(phi)
      const oy = depth * orbit.lift
      const x = ox * cosR - oy * sinR
      const y = ox * sinR + oy * cosR
      if (depth < 0 && x * x + y * y < 1) return null
      return [Math.floor(CX + x * R), Math.floor(CY + y * R)]
    }
    for (let i = 0; i < 72; i++) {
      const cell = at((i / 72) * Math.PI * 2)
      if (cell) put(cell[0], cell[1], SUBTLE)
    }
    const head = orbit.phase + t * orbit.speed
    // Half a cell per step, so the trail is a solid line before the dither thins it.
    const step = 0.5 / (orbit.radius * R)
    const back = -Math.sign(orbit.speed) * step
    for (let k = TRAIL / step; k > 0; k--) {
      const cell = at(head + k * back)
      const fade = 1 - (k * step) / TRAIL
      if (cell && fade * fade > threshold(cell[0], cell[1])) put(cell[0], cell[1], fade > 0.7 ? INK : MUTED)
    }
    const sat = at(head)
    if (sat)
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        put(sat[0] + dx, sat[1] + dy, orbit.ink)
  }
}

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

export function NewSessionPlate() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const cells = new Uint8Array(COLS * ROWS)
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      plateFrame(cells, STILL_T)
      paint(canvas, cells)
      return
    }
    // requestAnimationFrame already stops in a hidden tab.
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < FRAME_MS) return
      last = now
      plateFrame(cells, now / 1000)
      paint(canvas, cells)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div aria-hidden="true" className="mb-3 max-w-full">
      <canvas
        ref={ref}
        width={COLS * PITCH}
        height={ROWS * PITCH}
        data-plate="rove"
        className="h-auto w-96 max-w-full text-muted"
      />
    </div>
  )
}
