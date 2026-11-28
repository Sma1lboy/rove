/**
 * A row's status as 3×3 dots, the terminal's take on the web's `status-dots.tsx`: the grid sits
 * in two braille cells (both columns of the first, the left column of the second, top three rows),
 * where dots are half a cell apart across and a quarter down, so it reads as a square.
 *
 * Looks, shapes and levels come from `lib/status-dots.ts`, shared with the web. A cell has one
 * ink, so where the web fades a dot this lights or drops it, and a waiting dip dims the whole mark.
 */

import { DIM, type DotLook, STEP_MS, dotLevels, waitingDips } from "@sma1lboy/rove-core/lib/status-dots.ts"

/** A working dot lights once its level clears this: low enough that some dot is always lit. */
const WORKING_LIT = DIM + (1 - DIM) * 0.25
/** A settled dot lights when it is part of the shape. */
const SETTLED_LIT = 0.3

/** The dots `look` lights at wall-clock `now` (ms): the web's levels at that step, thresholded. */
export function litDots(look: DotLook, now: number): readonly number[] {
  if (look === "waiting") return [0, 1, 2, 3, 4, 5, 6, 7, 8]
  const floor = look === "working" ? WORKING_LIT : SETTLED_LIT
  return dotLevels(look, now / STEP_MS, Number.POSITIVE_INFINITY).flatMap((level, dot) => (level > floor ? [dot] : []))
}

/** Whether the mark is in a waiting dip at `now`, on the web's steps. */
export function dotsDip(look: DotLook, now: number): boolean {
  return look === "waiting" && waitingDips(now / STEP_MS)
}

/** Braille dot bits for the top three rows of a cell's left and right column. */
const LEFT = [0x01, 0x02, 0x04]
const RIGHT = [0x08, 0x10, 0x20]

/** Braille cells showing `lit` on a grid `cols` dots wide, three rows tall, row by row from the top left. */
function braille(lit: readonly number[], cols: number): string {
  const cells = new Array<number>(Math.ceil(cols / 2)).fill(0)
  for (const dot of lit) {
    const row = Math.floor(dot / cols)
    const col = dot % cols
    const cell = Math.floor(col / 2)
    cells[cell] = (cells[cell] ?? 0) | ((col % 2 === 0 ? LEFT : RIGHT)[row] ?? 0)
  }
  return String.fromCodePoint(...cells.map((bits) => 0x2800 + bits))
}

/** Two braille cells showing `lit` of the 3×3 grid. */
export function dotsGlyph(lit: readonly number[]): string {
  return braille(lit, 3)
}
