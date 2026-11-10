/**
 * The New session page's plate: a rover idling on a dotted line — wheels
 * turning, its beacon blinking, faint stars above — drawn the way a terminal
 * would. Decoration only: no strings, hidden from assistive tech, and a still
 * frame under `prefers-reduced-motion`.
 */

import { useEffect, useState } from "react"
import { everyVisible } from "./every-visible.ts"

/** Which tone a drawn cell takes. */
type Ink = "body" | "star" | "ground" | "beacon"

const WHEEL_FRAMES = ["(o)", "(O)", "(0)", "(O)"] as const
const GROUND = "·· ∙· ·· ∙· "
const SKY_ROWS = 2
const TICK_MS = 160

/** Stars as (row, col); each blinks on its own phase. */
const STARS: readonly (readonly [number, number])[] = [
  [0, 3],
  [0, 13],
  [0, 21],
  [1, 7],
  [1, 17],
]

/** Cabin, lights, chassis (with the arm) and undercarriage; wheels come after. */
const BODY = ["        .--------.  ", "     __/  .-..-.  \\__", "    |__|__|____|__|__|--", "       \\__|____|__/   "]
const WHEELS_AT: readonly number[] = [5, 16]
/** The arm already ends in `--`; the beacon sits right after it. */
const BEACON = { col: BODY[2]!.length }
const GROUND_ROW = SKY_ROWS + BODY.length + 1
const WIDTH = Math.max(...BODY.map((row) => row.length), GROUND.length) + 4

function blank(): string[][] {
  return Array.from({ length: GROUND_ROW + 1 }, () => Array.from({ length: WIDTH }, () => " "))
}

function put(rows: string[][], row: number, col: number, text: string): void {
  const line = rows[row]
  if (!line) return
  for (const [i, ch] of [...text].entries()) if (col + i < line.length) line[col + i] = ch
}

function grid(tick: number): string[][] {
  const rows = blank()
  // Sky: each star is on for two of every seven ticks.
  for (const [index, [row, col]] of STARS.entries()) {
    if ((tick + index * 2) % 7 > 1) continue
    put(rows, row, col, index % 2 === 0 ? "*" : ".")
  }
  for (const [i, line] of BODY.entries()) put(rows, SKY_ROWS + i, 0, line)
  // The wheels turn; the arm's beacon blinks.
  const wheel = WHEEL_FRAMES[tick % WHEEL_FRAMES.length] ?? WHEEL_FRAMES[0]
  for (const col of WHEELS_AT) put(rows, SKY_ROWS + BODY.length, col, wheel)
  put(rows, SKY_ROWS + 2, BEACON.col, "o")
  // The ground scrolls a cell per tick, so the rover reads as moving.
  const shift = tick % GROUND.length
  put(rows, GROUND_ROW, 0, (GROUND.repeat(Math.ceil(WIDTH / GROUND.length)) + GROUND).slice(shift, shift + WIDTH))
  return rows
}

function inkOf(row: number, col: number): Ink {
  if (row < SKY_ROWS) return "star"
  if (row === GROUND_ROW) return "ground"
  if (row === SKY_ROWS + BODY.length) return "ground"
  if (row === SKY_ROWS + 2 && col >= BEACON.col) return "beacon"
  return "body"
}

const TONE: Readonly<Record<Ink, string | undefined>> = {
  body: undefined,
  star: "text-subtle",
  ground: "text-subtle",
  beacon: "text-accent",
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function NewSessionPlate() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (reducedMotion()) return
    let frame = 0
    return everyVisible(TICK_MS, () => setTick(++frame))
  }, [])

  const rows = grid(tick)
  return (
    <pre
      aria-hidden="true"
      data-plate="rove"
      className="m-0 mb-3 select-none font-mono text-meta leading-none text-muted"
    >
      {rows.map((cells, y) => (
        // A fixed grid: a cell's position is its identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div key={y}>
          {cells.map((ch, x) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <span key={x} className={ch === " " ? undefined : TONE[inkOf(y, x)]}>
              {ch}
            </span>
          ))}
        </div>
      ))}
    </pre>
  )
}
