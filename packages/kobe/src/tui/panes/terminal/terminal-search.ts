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
 * Turn `[at, to)` within one logical line into a snapshot `SelectionRange`.
 * A hit that crosses a soft wrap spans rows, which is the shape `rowSpan`
 * already means by "first row from the start column, last row to the end
 * column" — so the existing highlight paints it with no changes.
 * Null when the hit covers no cells (zero-width marks only).
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
 * Every occurrence of `query` in `rows`, top-first, in ABSOLUTE snapshot
 * coordinates. An empty query yields nothing: it matches everywhere, which
 * is the same as matching nothing worth painting.
 *
 * Searching is done over LOGICAL lines: a row the emulator soft-wrapped is
 * half of the line above it, and a per-row `indexOf` cannot see a needle
 * straddling that break — it answers "no matches" for text the user can read
 * two rows up. `wrapped` is the snapshot's per-row flags; without them every
 * row is its own line, which is the pre-wrap behavior.
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
    // Compared on the whole SPAN, not the anchor alone: a hit across a soft
    // wrap starts one row above the viewport and still has a tail inside it.
    if (match.head.row < firstRow || match.anchor.row > lastRow) continue
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

/**
 * Which hit the viewport is parked on, addressed so it survives the buffer
 * moving underneath it.
 *
 * An array POSITION does not: the local scrollback is bounded, so once it
 * saturates every new line drops a hit off the front and every survivor
 * shifts down one slot — the counter keeps saying `3/5` while the accent
 * highlight has walked to a different occurrence. The absolute line id is the
 * same address `moveViewportScroll` anchors the viewport by, and it is stable
 * across a trim.
 *
 * `position` is the degraded form for backends with no stable line ids
 * (`PipeTaskPty`, mocks, the alternate screen): there is nothing better to
 * park on there, so it keeps the old behavior rather than pretending.
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
 * Re-derive the parked hit's position in a freshly recomputed match list.
 *
 * Returns -1 when the park cannot be honoured rather than pointing at a
 * neighbour: a resize reflows history and bumps `epoch`, so the recorded id
 * names content that no longer exists under that numbering —
 * `followWindowShift` drops a selection on exactly that signal, and guessing
 * here would put the accent on a line the user never walked to. A hit the
 * scrollback trimmed away falls forward to the next surviving hit, which is
 * where `enter` would have taken them anyway.
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
