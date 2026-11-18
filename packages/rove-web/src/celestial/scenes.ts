import { ACCENT, COLS, INK, MUTED, NONE, ROWS, SUBTLE, starField, threshold } from "./grid.ts"

/** Tilted ring plane: positive depth crosses in front of the globe. */
const TILT = -0.38
const COS = Math.cos(TILT)
const SIN = Math.sin(TILT)
const OPEN = 0.3

export function ringsFrame(cells: Uint8Array, t: number): void {
  starField(cells, t)
  const phase = t * 0.21
  const moonU = 55 * Math.cos(phase)
  const moonV = 21 * Math.sin(phase)
  const moonX = moonU * COS - moonV * SIN
  const moonY = moonU * SIN + moonV * COS

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col
      const x = col + 0.5 - COLS / 2
      const y = row + 0.5 - ROWS / 2
      const u = x * COS + y * SIN
      const v = y * COS - x * SIN
      const dither = threshold(col, row)
      const disk = (u * u + v * v) / (21 * 21)
      if (disk < 1) {
        const z = Math.sqrt(1 - disk)
        const light = Math.max(0, (-0.57 * u) / 21 - (0.68 * v) / 21 + 0.56 * z)
        const latitude = v / 21 + 0.17 * z
        const belts = 0.73 + 0.23 * Math.cos(latitude * 18 + 0.5 * Math.sin(phase + u / 9))
        cells[i] = light * belts > dither ? INK : disk > 0.94 && dither < 0.68 ? SUBTLE : NONE
      }
      const radius = Math.hypot(u, v / OPEN)
      if (radius >= 28 && radius < 53 && (disk >= 1 || v > 0)) {
        // Cassini's division stays dark even where it crosses the lit globe.
        const bands = 0.61 + 0.29 * Math.cos(radius * 1.4) + 0.1 * Math.sin(radius * 3 - phase)
        const shade = u > 10 && v < 0 && Math.abs(v) < 7 ? 0.32 : 1
        const gap = radius > 41.5 && radius < 44.5
        const density = gap ? 0 : bands * shade * (radius < 31 || radius > 49 ? 0.55 : 1)
        const glint = radius > 45 && radius < 47 && u < -8 && v > 0
        cells[i] = density > dither ? (glint ? ACCENT : v > 0 ? INK : MUTED) : NONE
      }
      const moon = Math.hypot(x - moonX, y - moonY)
      if (moon < 2 && (disk >= 1 || moonV > 0)) cells[i] = moon < 1.45 ? ACCENT : MUTED
    }
  }
}

const CRATERS = [
  [-0.33, -0.34, 0.22],
  [0.22, -0.5, 0.11],
  [-0.48, 0.2, 0.13],
  [0.15, 0.34, 0.27],
] as const

export function cometFrame(cells: Uint8Array, t: number): void {
  starField(cells, t)
  const phase = t * 0.27
  const headX = 26 + 6 * Math.cos(phase)
  const headY = 49 + 3 * Math.sin(phase)
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col
      const dither = threshold(col, row)
      const x = (col - 94) / 15
      const y = (row - 55) / 15
      const disk = x * x + y * y
      if (disk < 1) {
        const z = Math.sqrt(1 - disk)
        let light = -0.83 * x - 0.49 * y + 0.19 * z
        for (const [cx, cy, r] of CRATERS) {
          const d = Math.hypot(x - cx, y - cy) / r
          if (d < 1) light += d > 0.72 ? 0.22 : -0.3
        }
        cells[i] = light > dither ? (light > 0.54 ? INK : MUTED) : disk > 0.92 && dither < 0.28 ? SUBTLE : NONE
      }

      const dx = col - headX
      const dy = row - headY
      const length = dx / 80
      if (length > 0 && length < 1) {
        const center = -dx * 0.63 + 28 * length * length
        const width = 3 + 13 * length
        const cross = (dy - center) / width
        const dust = Math.max(0, 1 - Math.abs(cross))
        const strands = 0.58 + 0.42 * Math.cos(cross * 14 + length * 5 - phase)
        const ion = Math.max(0, 1 - Math.abs(dy + dx * 0.54) / 1.65)
        const density = (dust * strands + ion * 0.75) * (1 - length)
        if (density > dither) cells[i] = ion > 0.55 && length < 0.68 ? ACCENT : length < 0.56 ? INK : MUTED
      }
      const nucleus = Math.hypot(dx, dy)
      if (nucleus < 2.8) cells[i] = INK
      else if (nucleus < 8 && 0.84 * (1 - nucleus / 8) ** 1.3 > dither) cells[i] = ACCENT
    }
  }
}
