/**
 * Plain-substring search over the terminal pane's LOCAL scrollback. Pure and
 * cell-addressed: hits are `SelectionRange`s, so selection's paint and
 * coordinates carry search too.
 *
 * Case-insensitive, literal, non-overlapping. No regex: a half-typed regex
 * matching nothing is worse than no feature.
 */

import { charWidth } from "../../../lib/display-width"
import type { Chunk } from "./sgr"
import { type SelectionRange, type SpanPaint, overlaySelection } from "./terminal-selection"
import { type LogicalLine, type RowWrapFlags, logicalLines, rowAtOffset } from "./terminal-wrap"

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
 * Lowercase without moving any index (`indexOf` must address the original);
 * `İ`, and `ẞ` on some engines, lowercase to more than one unit.
 * ponytail: such a row falls back to case-SENSITIVE matching; per-code-point
 * folding costs a full scrollback walk per keystroke — do it only if someone
 * searches Turkish build logs.
 */
function foldCase(text: string): string {
  const lower = text.toLowerCase()
  return lower.length === text.length ? lower : text
}

/**
 * `[at, to)` within one logical line as a snapshot `SelectionRange`; a hit
 * across a soft wrap spans rows, which the selection highlight already
 * paints. Null when it covers no cells (zero-width marks only).
 */
function matchRange(line: LogicalLine, at: number, to: number): SelectionRange | null {
  if (cellWidth(line.text.slice(at, to)) <= 0) return null
  const head = rowAtOffset(line, to - 1)
  const anchor = rowAtOffset(line, at)
  const headFrom = Math.max(at, head.start)
  const headCol = cellWidth(line.text.slice(head.start, headFrom))
  return {
    anchor: { row: anchor.row, col: cellWidth(line.text.slice(anchor.start, at)) },
    head: { row: head.row, col: headCol + cellWidth(line.text.slice(headFrom, to)) - 1 },
  }
}

/**
 * Every occurrence of `query`, top-first, in ABSOLUTE snapshot coordinates;
 * empty query → none. Searched over LOGICAL lines so a needle straddling a
 * soft wrap is found. Without `wrapped` flags every row is its own line.
 */
export function findMatches(
  rows: readonly (readonly Chunk[])[],
  query: string,
  wrapped?: RowWrapFlags,
): readonly SelectionRange[] {
  const needle = foldCase(query)
  if (needle.length === 0) return []
  const out: SelectionRange[] = []
  for (const line of logicalLines(
    rows.map((row) => rowText(row ?? [])),
    wrapped,
  )) {
    const haystack = foldCase(line.text)
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) break
      from = at + needle.length
      const range = matchRange(line, at, from)
      if (range) out.push(range)
    }
  }
  return out
}

/**
 * Paint matches inside the rendered window, `current` in its own tone.
 * ponytail: one `overlaySelection` pass per visible hit (a one-letter query
 * can put ~100 on screen); bucket by row if it shows in a frame profile.
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
    // Whole span: a wrapped hit can start above the viewport with a tail inside.
    if (match.head.row < firstRow || match.anchor.row > lastRow) continue
    out = overlaySelection(out, match, firstRow, width, i === current ? currentPaint : "inverse")
  }
  return out
}

/**
 * Scroll offset putting `row` a third of the way down (lines after a hit
 * usually explain it). Visible rows still get an offset; the caller decides.
 */
export function scrollOffsetForRow(total: number, height: number, row: number): number {
  const body = Math.max(1, height)
  const max = Math.max(0, total - body)
  return Math.min(max, Math.max(0, total - body + Math.floor(body / 3) - row))
}

/**
 * The hit the viewport is parked on, addressed by absolute line id (stable
 * across scrollback trims, as `moveViewportScroll` uses) — an array position
 * shifts as a saturated buffer drops hits off the front. `position` is the
 * fallback for backends without stable ids (`PipeTaskPty`, mocks, alt screen).
 */
export type ParkedHit =
  | { readonly kind: "line"; readonly epoch: number; readonly line: number; readonly col: number }
  | { readonly kind: "position"; readonly at: number }

/** Address match `at` for parking, given the snapshot's current window. */
export function parkHit(
  matches: readonly SelectionRange[],
  at: number,
  window: { readonly epoch: number; readonly startLine: number } | null,
): ParkedHit | null {
  const match = matches[at]
  if (!match) return null
  if (!window) return { kind: "position", at }
  return { kind: "line", epoch: window.epoch, line: window.startLine + match.anchor.row, col: match.anchor.col }
}

/**
 * The parked hit's index in a recomputed match list. -1 on an `epoch` change
 * (a resize reflowed history, so the id names nothing — same signal
 * `followWindowShift` drops a selection on). A trimmed hit falls forward to
 * the next surviving one.
 */
export function resolveParkedIndex(
  parked: ParkedHit | null,
  matches: readonly SelectionRange[],
  window: { readonly epoch: number; readonly startLine: number } | null,
): number {
  if (!parked || matches.length === 0) return -1
  if (parked.kind === "position") return Math.min(parked.at, matches.length - 1)
  if (!window || window.epoch !== parked.epoch) return -1
  let fallback = -1
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i] as SelectionRange
    const line = window.startLine + match.anchor.row
    if (line === parked.line && match.anchor.col === parked.col) return i
    if (fallback < 0 && line >= parked.line) fallback = i
  }
  return fallback >= 0 ? fallback : matches.length - 1
}
