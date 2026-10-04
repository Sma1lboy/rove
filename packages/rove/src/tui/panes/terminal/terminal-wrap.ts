/**
 * Soft-wrap grouping for the terminal snapshot grid. xterm's `isWrapped`
 * can't be recovered from cells, and without it copy splits a wrapped path
 * and search misses needles across the break. The one definition of
 * "continuation": `extractSelection` reads it directly, `findMatches` via
 * {@link logicalLines}.
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

/** Group row texts into logical lines; without flags each row is its own line. */
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
