/**
 * Which rows must be mounted for a viewport of `height` rows scrolled to
 * `top`. No `@opentui/*` import so vitest can pin the invariant: the range
 * always COVERS every visible row (a too-small window is also "faster").
 */

/** Rows kept above and below the viewport so a one-line scroll never shows a gap. */
const OVERSCAN = 16

/** Rows rendered before the first layout has given the viewport a height. */
const PRE_LAYOUT_ROWS = 64

export function rowWindowRange(top: number, height: number, rowCount: number): { start: number; end: number } {
  if (rowCount <= 0) return { start: 0, end: 0 }
  // Pre-layout: a bounded prefix, never nothing — an empty window here would
  // paint a blank pane that only a later scroll could repair.
  if (height <= 0) return { start: 0, end: Math.min(rowCount, PRE_LAYOUT_ROWS) }
  const end = Math.min(rowCount, Math.ceil(top + height) + OVERSCAN)
  // Clamp `start` INSIDE the list: a list shrinking under a scrolled viewport
  // puts `top` past the end, giving start > end (blank pane, negative spacer).
  // `end - 1` keeps at least one row mounted.
  const start = Math.max(0, Math.min(Math.floor(top) - OVERSCAN, end - 1))
  return { start, end }
}
