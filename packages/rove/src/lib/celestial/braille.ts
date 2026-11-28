import { COLS, NONE, ROWS } from "@sma1lboy/rove-core/lib/celestial/grid.ts"

/** One run of braille characters sharing an ink. */
export interface BrailleRun {
  readonly ink: number
  readonly text: string
}

/** Dot bit for (dx, dy) inside a 2×4 braille cell. */
const BIT = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80]

/** The COLS × ROWS ink grid as rows of braille runs (2×4 dots per character); a character takes its brightest dot's ink. */
export function brailleRows(cells: Uint8Array): BrailleRun[][] {
  const rows: BrailleRun[][] = []
  for (let top = 0; top < ROWS; top += 4) {
    const runs: { ink: number; text: string }[] = []
    for (let left = 0; left < COLS; left += 2) {
      let bits = 0
      let ink = NONE
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cell = cells[(top + dy) * COLS + left + dx] ?? NONE
          if (cell === NONE) continue
          bits |= BIT[dy * 2 + dx] ?? 0
          if (cell > ink) ink = cell
        }
      }
      const char = bits === 0 ? " " : String.fromCodePoint(0x2800 + bits)
      const last = runs[runs.length - 1]
      if (last && last.ink === ink) last.text += char
      else runs.push({ ink, text: char })
    }
    rows.push(runs)
  }
  return rows
}
