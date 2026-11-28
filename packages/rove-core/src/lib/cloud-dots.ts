/**
 * The cloud that marks a task on another machine in the terminal, as braille dots. Braille dots sit
 * far apart and leave a gap between cells, so the outline is kept small enough to hold together.
 * Two braille cells.
 */
export const TERMINAL_CLOUD_DOT_ROWS = [".##.", "#..#", "####"] as const

/** Braille's bit per dot of a 2×4 cell, row by row. */
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const

/** `rows` (up to four, `#` = dot) as braille characters, two columns per cell. */
export function brailleOf(rows: readonly string[]): string {
  const width = Math.max(...rows.map((row) => row.length))
  let out = ""
  for (let col = 0; col < width; col += 2) {
    let bits = 0
    for (const [y, row] of rows.entries()) {
      if (row[col] === "#") bits |= BRAILLE_BITS[y]?.[0] ?? 0
      if (row[col + 1] === "#") bits |= BRAILLE_BITS[y]?.[1] ?? 0
    }
    out += String.fromCodePoint(0x2800 + bits)
  }
  return out
}
