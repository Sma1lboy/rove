/**
 * A row's status as 3×3 dots, the terminal's take on the web's `status-dots.tsx`: the grid sits
 * in two braille cells (both columns of the first, the left column of the second, top three rows),
 * where dots are half a cell apart across and a quarter down, so it reads as a square.
 *
 * Looks, shapes and the beat come from `lib/status-dots.ts`, shared with the web. A cell has one
 * ink, so where the web fades a dot this lights or drops it, and a waiting dip dims the whole mark.
 */

import { DOT_SHAPE, type DotLook, RIPPLE_S, STEP_MS, waitingDips } from "@/lib/status-dots"

/** One ripple out from the centre: the centre, a plus, its arms, the corners. None is a settled shape. */
const RIPPLE: readonly (readonly number[])[] = [[4], [1, 3, 4, 5, 7], [1, 3, 5, 7], [0, 2, 6, 8]]
const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8]

/** The dots `look` lights at wall-clock `now` (ms): work ripples once per {@link RIPPLE_S}, as the web's does. */
export function litDots(look: DotLook, now: number): readonly number[] {
  if (look === "waiting") return ALL
  if (look !== "working") return DOT_SHAPE[look]
  const frame = (RIPPLE_S * 1000) / RIPPLE.length
  return RIPPLE[Math.floor(Math.abs(now) / frame) % RIPPLE.length] ?? []
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

/** A cloud in three cells, for a row whose task runs on another machine: a hump over a flat base. */
export const CLOUD_DOTS = braille([2, 3, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17], 6)
