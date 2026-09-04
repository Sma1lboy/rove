/**
 * Plain-substring search over the terminal pane's LOCAL scrollback.
 *
 * Everything here is pure and cell-addressed, like `terminal-selection.ts`
 * next door, and for the same reason: a hit is handed back as a
 * `SelectionRange`, so the highlight paint and the coordinate space the pane
 * already uses for selection carry the search too — no second notion of
 * "a piece of the buffer".
 *
 * Matching is case-insensitive, literal, and non-overlapping. No regex mode:
 * what people look for in a build log is a file name or an error string, and
 * a half-typed regex matching nothing is worse than no feature.
 */

import { charWidth } from "../../../lib/display-width"
import type { Chunk } from "./sgr"
import { type SelectionRange, type SpanPaint, overlaySelection } from "./terminal-selection"

/** Terminal-cell width of text: wide glyphs count 2, combining marks 0. */
function cellWidth(text: string): number {
  let cells = 0
  for (const ch of text) cells += charWidth(ch.codePointAt(0) as number)
  return cells
}

/** Concatenated plain text of one snapshot row. */
function rowText(row: readonly Chunk[]): string {
  let out = ""
  for (const chunk of row) out += chunk.text
  return out
}

/**
 * Lowercase WITHOUT moving any index — the `indexOf` result has to address
 * the original string, and a few code points (`İ`, and `ẞ` under some
 * engines) lowercase to more than one unit.
 * ponytail: a row containing one of those falls back to case-SENSITIVE
 * matching. Per-code-point folding would fix it and costs a full array walk
 * of the scrollback on every keystroke; take that trade only if someone is
 * actually searching Turkish build logs.
 */
function foldCase(text: string): string {
  const lower = text.toLowerCase()
  return lower.length === text.length ? lower : text
}

/**
 * Every occurrence of `query` in `rows`, top-first, in ABSOLUTE snapshot
 * coordinates. An empty query yields nothing: it matches everywhere, which
 * is the same as matching nothing worth painting.
 */
export function findMatches(rows: readonly (readonly Chunk[])[], query: string): readonly SelectionRange[] {
  const needle = foldCase(query)
  if (needle.length === 0) return []
  const out: SelectionRange[] = []
  for (let row = 0; row < rows.length; row++) {
    const text = rowText(rows[row] ?? [])
    const haystack = foldCase(text)
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) break
      from = at + needle.length
      const col = cellWidth(text.slice(0, at))
      const width = cellWidth(text.slice(at, from))
      // A hit made only of zero-width marks covers no cells to highlight.
      if (width > 0) out.push({ anchor: { row, col }, head: { row, col: col + width - 1 } })
    }
  }
  return out
}

/**
 * Paint the matches that fall inside the rendered window, with the one at
 * `current` in its own tone: while walking hits you need to see which of the
 * highlights on screen is the one `enter` will move away from.
 *
 * ponytail: one `overlaySelection` pass per visible hit — a one-letter query
 * can put a hundred on screen, which is a hundred cheap row maps over a
 * viewport-sized array. Bucket by row if that ever shows up in a frame
 * profile.
 */
export function overlayMatches(
  rows: readonly (readonly Chunk[])[],
  matches: readonly SelectionRange[],
  current: number,
  firstRow: number,
  width: number,
  currentPaint: SpanPaint,
): readonly (readonly Chunk[])[] {
  if (matches.length === 0) return rows
  const lastRow = firstRow + rows.length - 1
  let out = rows
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i] as SelectionRange
    if (match.anchor.row < firstRow || match.anchor.row > lastRow) continue
    out = overlaySelection(out, match, firstRow, width, i === current ? currentPaint : "inverse")
  }
  return out
}

/**
 * The scroll offset that brings absolute row `row` into view, parked a third
 * of the way down the body rather than centered: the lines AFTER a hit are
 * usually the ones that explain it, so they get the larger half of the pane.
 * Already-visible rows still resolve to a valid offset — the caller decides
 * whether moving is worth it.
 */
export function scrollOffsetForRow(total: number, height: number, row: number): number {
  const body = Math.max(1, height)
  const max = Math.max(0, total - body)
  return Math.min(max, Math.max(0, total - body + Math.floor(body / 3) - row))
}
