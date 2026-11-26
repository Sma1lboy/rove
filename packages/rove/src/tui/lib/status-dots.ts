/**
 * A row's status as 3×3 dots, the terminal's take on the web's `status-dots.tsx`: the grid sits
 * in two braille cells (both columns of the first, the left column of the second, top three rows),
 * where dots are half a cell apart across and a quarter down, so it reads as a square.
 *
 * A cell has one ink, so where the web fades a dot this lights or drops it: work ripples out from
 * the centre, every other look holds its shape.
 */

import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"

export type DotLook = "working" | "waiting" | "error" | "done" | "idle"

/** Mirrors `dotLook` in rove-web's `rail-glyphs.ts`: a rate limit clears itself, so it waits rather than fails. */
export function dotLook(status: RowStatus | undefined): DotLook {
  switch (status?.kind) {
    case "busy":
    case "running":
      return "working"
    case "needs-input":
      return "waiting"
    case "attention":
      return status.reason === "rate_limited" ? "waiting" : "error"
    case "unseen":
      return "done"
    default:
      return "idle"
  }
}

/** Dots row by row from the top left. Idle is a ring, done a tick, error a cross, waiting the full grid. */
const SHAPE: Readonly<Record<Exclude<DotLook, "working">, readonly number[]>> = {
  idle: [0, 1, 2, 3, 5, 6, 7, 8],
  done: [3, 7, 5, 2],
  error: [0, 4, 8, 2, 6],
  waiting: [0, 1, 2, 3, 4, 5, 6, 7, 8],
}

/** One ripple out from the centre: the centre, a plus, its arms, the corners. None is a settled shape. */
const RIPPLE: readonly (readonly number[])[] = [[4], [1, 3, 4, 5, 7], [1, 3, 5, 7], [0, 2, 6, 8]]
/** Spinner ticks each ripple frame holds. */
const HOLD = 2

/** The dots `look` lights at spinner `tick`. */
export function litDots(look: DotLook, tick: number): readonly number[] {
  if (look !== "working") return SHAPE[look]
  return RIPPLE[Math.floor(Math.abs(tick) / HOLD) % RIPPLE.length] ?? []
}

/** Braille dot bits for the top three rows of a cell's left and right column. */
const LEFT = [0x01, 0x02, 0x04]
const RIGHT = [0x08, 0x10, 0x20]

/** Two braille cells showing `lit`. */
export function dotsGlyph(lit: readonly number[]): string {
  let first = 0
  let second = 0
  for (const dot of lit) {
    const row = Math.floor(dot / 3)
    const col = dot % 3
    if (col === 0) first |= LEFT[row] ?? 0
    else if (col === 1) first |= RIGHT[row] ?? 0
    else second |= LEFT[row] ?? 0
  }
  return String.fromCodePoint(0x2800 + first, 0x2800 + second)
}
