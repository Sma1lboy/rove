/**
 * Soft-wrap grouping for the terminal snapshot.
 *
 * The snapshot is a GRID: one entry per terminal row. xterm marks a row
 * `isWrapped` when it is the continuation of the row above — the emulator ran
 * out of columns and broke ONE logical line across several rows. Nothing
 * downstream can recover that from the cells, so both places a user touches
 * text would otherwise read the break as a real newline: a copied path comes
 * back in pieces, and a needle lying across the boundary exists in no single
 * row and is reported as "no matches".
 *
 * One definition of "continuation" lives here. `extractSelection` reads it
 * directly (it only needs "does this row continue the last one"), and
 * `findMatches` reads it through {@link logicalLines}, which also carries the
 * offsets a hit needs to map back onto grid coordinates.
 */

/** Per-snapshot-row soft-wrap flags, parallel to the snapshot rows. */
export type RowWrapFlags = readonly boolean[]

/** Row `row` is the soft-wrap continuation of `row - 1`. */
export function isWrapContinuation(wrapped: RowWrapFlags | undefined, row: number): boolean {
  return row > 0 && wrapped?.[row] === true
}

/** One logical line: the rows it spans, joined, plus where each row starts in the join. */
export type LogicalLine = {
  readonly text: string
  /** Absolute snapshot index of the first row. */
  readonly firstRow: number
  /** `starts[i]` is the offset in `text` at which row `firstRow + i` begins. */
  readonly starts: readonly number[]
}

/**
 * Group row texts into logical lines. With no flags (a backend that cannot
 * report wrapping) every row is its own logical line, which is exactly
 * today's behavior.
 */
export function logicalLines(rowTexts: readonly string[], wrapped: RowWrapFlags | undefined): readonly LogicalLine[] {
  const out: { text: string; firstRow: number; starts: number[] }[] = []
  for (let row = 0; row < rowTexts.length; row++) {
    const text = rowTexts[row] ?? ""
    const last = out[out.length - 1]
    if (last && isWrapContinuation(wrapped, row)) {
      last.starts.push(last.text.length)
      last.text += text
      continue
    }
    out.push({ text, firstRow: row, starts: [0] })
  }
  return out
}

/** The row of `line` holding `offset`, and that row's start offset within the join. */
export function rowAtOffset(line: LogicalLine, offset: number): { row: number; start: number } {
  let i = line.starts.length - 1
  while (i > 0 && (line.starts[i] as number) > offset) i--
  return { row: line.firstRow + i, start: line.starts[i] as number }
}
