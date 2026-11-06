/**
 * The first-run screen's picture, as text: one `main` trunk forks into parallel session lanes
 * (the product in one glance: several agents running side by side), each lane grows from the
 * trunk, runs with a pulse and a working head, then finishes; the picture wipes away and starts
 * over. Pure and deterministic: `frameAt(tick, cols)` is the whole animation, so a test can pin
 * it and a reduced-motion client can draw one tick. ASCII only, so every glyph is one cell in any
 * monospace face and no translation can break the grid.
 */

/** Lines in every frame; the caller reserves exactly this many. */
export const FLOW_ROWS = 11
/** Narrowest and widest grid the picture is drawn for. */
export const FLOW_MIN_COLS = 24
export const FLOW_MAX_COLS = 64
/** Frames per second the caller plays at. */
export const FLOW_FPS = 12
/** The tick a client that does not animate draws: every lane is grown, some are done, some still run. */
export const FLOW_REST_TICK = 90

const CYCLE = 150
const WIPE_FROM = 128
const TRUNK_X = 0
const FIRST_LANE_ROW = 2

interface Lane {
  /** Share of the free width the lane runs to. */
  readonly reach: number
  /** Columns its head advances per tick while growing. */
  readonly grow: number
  /** Columns its pulse travels per tick. */
  readonly pulse: number
  /** The tick the lane finishes at. */
  readonly done: number
}

/** Fixed, uneven, and not random: sessions that start together do not end together. */
const LANES: readonly Lane[] = [
  { reach: 0.96, grow: 1.5, pulse: 0.9, done: 104 },
  { reach: 0.72, grow: 1.1, pulse: 1.2, done: 84 },
  { reach: 1, grow: 1.7, pulse: 0.7, done: 116 },
  { reach: 0.84, grow: 1.3, pulse: 1.0, done: 96 },
  { reach: 0.62, grow: 1.2, pulse: 1.3, done: 80 },
]
const SPINNER = "/-\\|"
const PULSE_EVERY = 6

export interface FlowFrame {
  /** The trunk and the lanes' trails, to draw in a quiet tone. */
  readonly base: string
  /** The `main` node, the heads and the pulses, to draw over `base` in the accent. Spaces elsewhere. */
  readonly accent: string
}

type Grid = string[][]

const put = (grid: Grid, x: number, y: number, ch: string): void => {
  const row = grid[y]
  if (row && x >= 0 && x < row.length) row[x] = ch
}

export function frameAt(tick: number, cols: number): FlowFrame {
  const width = Math.min(FLOW_MAX_COLS, Math.max(FLOW_MIN_COLS, Math.floor(cols)))
  const t = ((Math.floor(tick) % CYCLE) + CYCLE) % CYCLE
  const base: Grid = Array.from({ length: FLOW_ROWS }, () => new Array<string>(width).fill(" "))
  const accent: Grid = Array.from({ length: FLOW_ROWS }, () => new Array<string>(width).fill(" "))

  put(accent, TRUNK_X, 0, "o")
  const lastRow = FIRST_LANE_ROW + 2 * (LANES.length - 1)
  const trunkEnd = Math.min(lastRow, Math.floor(t / 2))
  for (let y = 1; y <= trunkEnd; y++) put(base, TRUNK_X, y, "|")

  LANES.forEach((lane, i) => {
    const y = FIRST_LANE_ROW + 2 * i
    const forkAt = 2 * y
    if (t < forkAt) return
    put(base, TRUNK_X, y, "+")
    const from = TRUNK_X + 1
    const room = width - 1 - from
    const end = from + Math.max(1, Math.floor(room * lane.reach))
    const head = Math.min(end, from + Math.floor((t - forkAt) * lane.grow))
    const finished = t >= lane.done && head === end
    for (let x = from; x < head; x++) {
      const pulsing = !finished && (((x - Math.floor(t * lane.pulse)) % PULSE_EVERY) + PULSE_EVERY) % PULSE_EVERY === 0
      if (pulsing) put(accent, x, y, "=")
      else put(base, x, y, "-")
    }
    if (finished) put(accent, head, y, "o")
    else if (head < end) put(accent, head, y, ">")
    else put(accent, head, y, SPINNER[(Math.floor(t / 2) + i) % SPINNER.length] ?? "-")
  })

  if (t >= WIPE_FROM) {
    // The picture leaves the way it arrived, left to right, so the next trunk grows on a clean sheet.
    const wiped = Math.ceil(((t - WIPE_FROM + 1) / (CYCLE - WIPE_FROM)) * (width + 1))
    for (const grid of [base, accent]) for (const row of grid) row.fill(" ", 0, Math.min(width, wiped))
  }
  return {
    base: base.map((row) => row.join("")).join("\n"),
    accent: accent.map((row) => row.join("")).join("\n"),
  }
}
