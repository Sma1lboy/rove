/**
 * The pure half of file-tree row windowing: which row indices must be mounted
 * for a viewport of `height` rows scrolled to `top`.
 *
 * Its own module, with no `@opentui/*` import, so the ONE property that makes
 * windowing safe can be tested on the vitest track: the returned range always
 * COVERS every row the viewport can show. A window that is merely too small
 * makes the timing probe faster in exactly the same way a correct one does —
 * coverage is what tells a speedup from silently dropped rows.
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
  // `start` is clamped INSIDE the list, not just at 0. A `top` past the end —
  // which is what a list shrinking under a scrolled viewport looks like (tab
  // switch, a directory collapsing, a git refresh dropping files) — otherwise
  // gives start > end: an empty window AND a negative bottom-spacer height,
  // i.e. a blank pane. `end - 1` keeps at least one row mounted whenever the
  // list has one.
  const start = Math.max(0, Math.min(Math.floor(top) - OVERSCAN, end - 1))
  return { start, end }
}
