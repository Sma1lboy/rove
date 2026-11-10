/**
 * Soft-wrap flags for the terminal snapshot grid. xterm's `isWrapped` can't
 * be recovered from cells, and without it copy splits a wrapped path. The one
 * definition of "continuation", read by `extractSelection`.
 */

/** Per-snapshot-row soft-wrap flags, parallel to the snapshot rows. */
export type RowWrapFlags = readonly boolean[]

/** Row `row` is the soft-wrap continuation of `row - 1`. */
export function isWrapContinuation(wrapped: RowWrapFlags | undefined, row: number): boolean {
  return row > 0 && wrapped?.[row] === true
}
