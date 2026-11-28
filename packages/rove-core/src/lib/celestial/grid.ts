export const COLS = 128
export const ROWS = 80
export const NONE = 0
export const SUBTLE = 1
export const MUTED = 2
export const INK = 3
export const ACCENT = 4
/** 8×8 Bayer thresholds in (0, 1): a cell is lit when its brightness clears its threshold. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const BAYER = Array.from({ length: 64 }, (_, i) => {
  const x = i % 8
  const y = i >> 3
  return (4 * (BAYER4[(y & 3) * 4 + (x & 3)] ?? 0) + ([0, 2, 3, 1][(y >> 2) * 2 + (x >> 2)] ?? 0) + 0.5) / 64
})
export const threshold = (col: number, row: number) => BAYER[(row & 7) * 8 + (col & 7)] ?? 1

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

export function starField(cells: Uint8Array, t: number) {
  cells.fill(NONE)
  for (const [col, row, phase] of STARS) if (Math.sin(t * 0.8 + phase) > -0.5) cells[row * COLS + col] = SUBTLE
}
