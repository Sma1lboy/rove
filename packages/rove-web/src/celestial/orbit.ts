import { ACCENT, COLS, INK, MUTED, NONE, ROWS, SUBTLE, starField, threshold } from "./grid.ts"

const CX = COLS / 2
const CY = ROWS / 2
/** Planet radius in cells. */
const R = 25
/** Squared radius where the outermost ring of cells starts. */
const LIMB = (1 - 1.2 / R) ** 2
/** radius in planet radii, `lift` = how open the ellipse reads, `roll` = its tilt on screen. */
const ORBITS = [
  { radius: 1.55, lift: 0.3, roll: -0.42, speed: 0.9, phase: 0.4, ink: ACCENT },
  { radius: 1.95, lift: 0.22, roll: 0.3, speed: -0.55, phase: 2.6, ink: INK },
  { radius: 2.4, lift: 0.36, roll: -0.12, speed: 0.38, phase: 4.4, ink: INK },
] as const
/** Trail length in radians of orbit. */
const TRAIL = 1.9

/** Fills `cells` (COLS × ROWS inks) with the scene at `t` seconds. */
export function orbitFrame(cells: Uint8Array, t: number): void {
  starField(cells, t)
  const put = (col: number, row: number, ink: number) => {
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) cells[row * COLS + col] = ink
  }

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
      if (light ** 0.75 * (0.4 + 0.6 * band) > threshold(col, row)) put(col, row, light > 0.4 ? INK : MUTED)
      // A one-cell limb keeps the night side reading as a sphere.
      else if (r2 > LIMB) put(col, row, SUBTLE)
    }
  }

  // Orbits: a faint dotted ellipse, then a satellite whose trail dithers out behind it.
  for (const orbit of ORBITS) {
    const sinR = Math.sin(orbit.roll)
    const cosR = Math.cos(orbit.roll)
    /** Cell under orbit angle `phi` and whether it crosses the planet's face, or null where the planet hides it. */
    const at = (phi: number): readonly [number, number, boolean] | null => {
      const ox = orbit.radius * Math.cos(phi)
      const depth = orbit.radius * Math.sin(phi)
      const oy = depth * orbit.lift
      const x = ox * cosR - oy * sinR
      const y = ox * sinR + oy * cosR
      const over = x * x + y * y < 1
      if (depth < 0 && over) return null
      return [Math.floor(CX + x * R), Math.floor(CY + y * R), over]
    }
    // The path: a dot every other cell, left off the planet's face so it does not read as surface.
    const dots = Math.round(Math.PI * orbit.radius * R)
    for (let i = 0; i < dots; i++) {
      const cell = at((i / dots) * Math.PI * 2)
      if (cell && !cell[2]) put(cell[0], cell[1], SUBTLE)
    }
    const head = orbit.phase + t * orbit.speed
    // Half a cell per step, so the trail is a solid line before the dither thins it.
    const step = 0.5 / (orbit.radius * R)
    const back = -Math.sign(orbit.speed) * step
    // Crossing the face, the trail first clears a gap in the surface so it stays legible.
    for (let k = TRAIL / step; k >= 0; k--) {
      const cell = at(head + k * back)
      if (!cell?.[2]) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) put(cell[0] + dx, cell[1] + dy, NONE)
    }
    for (let k = TRAIL / step; k > 0; k--) {
      const cell = at(head + k * back)
      const fade = 1 - (k * step) / TRAIL
      if (cell && fade > threshold(cell[0], cell[1])) put(cell[0], cell[1], fade > 0.6 ? orbit.ink : MUTED)
    }
    const sat = at(head)
    if (sat) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(sat[0] + dx, sat[1] + dy, orbit.ink)
  }
}
