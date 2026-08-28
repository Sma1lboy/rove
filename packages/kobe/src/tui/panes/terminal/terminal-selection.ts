/**
 * Grid-based selection for the embedded terminal pane — the way real
 * terminal emulators select, replacing opentui's text-flow selection
 * which broke over this pane (the snapshot <text> is replaced wholesale
 * on every PTY frame, so flow anchors were invalidated mid-drag:
 * glitchy highlight, empty extraction).
 *
 * Everything here is pure and cell-addressed: a selection is an anchor
 * and a head in ABSOLUTE snapshot coordinates (row = index into the
 * full snapshot row array, col = terminal column), normalized into
 * per-row spans with linear reading-order semantics (first row from
 * the start column, middle rows whole, last row to the end column) —
 * exactly xterm/tmux selection shape. The component owns the mouse
 * wiring and the copy; `overlaySelection` reuses the cursor overlay's
 * chunk-splitting to paint the highlight, so it survives every frame
 * refresh untouched.
 */

import { charWidth } from "../../../lib/display-width"
import type { TerminalSnapshotWindow } from "./pty-types"
import { ATTR, type Chunk } from "./sgr"

export type CellPoint = { readonly row: number; readonly col: number }
export type SelectionRange = { readonly anchor: CellPoint; readonly head: CellPoint }

/**
 * The absolute snapshot cell under a pointer, plus the auto-scroll pull that
 * pointer position asks for.
 *
 * `viewCol`/`viewRow` are pointer coordinates RELATIVE to the pane body and
 * may be negative or past the last row: opentui captures the drag to the
 * element the press started on, so a drag that leaves the pane keeps
 * reporting real coordinates.
 *
 * `edgePull` counts from the EDGE ROW, not from outside the pane — the first
 * visible row already pulls by 1, one row above it by 2, and so on (mirrored
 * at the bottom). A terminal pane sits flush under a one-row tab strip, so
 * "drag beyond the pane" is a one-row target the pointer rarely hits;
 * emulators scroll at the pane boundary itself, and so do we. The cell stays
 * a valid snapshot address either way (column clamped to the grid, row to the
 * snapshot). Selection coordinates are absolute, so the row under a
 * stationary pointer changes as the viewport scrolls — that is what lets a
 * held drag keep extending into scrollback.
 */
export function pointerCell(
  viewCol: number,
  viewRow: number,
  grid: { cols: number; rows: number },
  visibleStart: number,
  snapshotLength: number,
): { cell: CellPoint; edgePull: number } {
  const col = Math.min(grid.cols - 1, Math.max(0, viewCol))
  const row = Math.min(Math.max(0, snapshotLength - 1), Math.max(0, visibleStart + viewRow))
  const lastRow = grid.rows - 1
  const edgePull = viewRow <= 0 ? viewRow - 1 : viewRow >= lastRow ? viewRow - lastRow + 1 : 0
  return { cell: { row, col }, edgePull }
}

/** Reading-order normalize: start is the earlier of anchor/head. */
export function orderRange(range: SelectionRange): { start: CellPoint; end: CellPoint } {
  const { anchor, head } = range
  const headFirst = head.row < anchor.row || (head.row === anchor.row && head.col < anchor.col)
  return headFirst ? { start: head, end: anchor } : { start: anchor, end: head }
}

/**
 * The selected column span `[from, to)` of `row`, or null when the row
 * is outside the selection. `width` bounds full-row spans.
 */
export function rowSpan(range: SelectionRange, row: number, width: number): readonly [number, number] | null {
  const { start, end } = orderRange(range)
  if (row < start.row || row > end.row) return null
  const from = row === start.row ? start.col : 0
  const to = row === end.row ? end.col + 1 : width
  return from < to ? [from, to] : null
}

/** Concatenated plain text of one snapshot row. */
function rowText(row: readonly Chunk[]): string {
  let s = ""
  for (const chunk of row) s += chunk.text
  return s
}

/** Terminal-cell width of text, preserving zero-width combining marks. */
function textCells(text: string): number {
  let cells = 0
  for (const ch of text) cells += charWidth(ch.codePointAt(0) as number)
  return cells
}

type CellSlice = { readonly before: string; readonly selected: string; readonly after: string }

/**
 * Split text around a terminal-cell span. A wide glyph is kept whole when
 * either of its two cells intersects the span; zero-width marks stay attached
 * to the preceding glyph instead of becoming independently selectable.
 */
function sliceTextByCells(text: string, from: number, to: number): CellSlice {
  let before = ""
  let selected = ""
  let after = ""
  let col = 0
  let lastPart: keyof CellSlice = "before"

  for (const ch of text) {
    const width = charWidth(ch.codePointAt(0) as number)
    if (width === 0) {
      if (lastPart === "selected") selected += ch
      else if (lastPart === "after") after += ch
      else before += ch
      continue
    }

    const end = col + width
    if (end <= from) {
      before += ch
      lastPart = "before"
    } else if (col >= to) {
      after += ch
      lastPart = "after"
    } else {
      selected += ch
      lastPart = "selected"
    }
    col = end
  }

  return { before, selected, after }
}

/**
 * Extract the selected text: per-row slice by span, trailing whitespace
 * trimmed per line, lines joined with \n.
 *
 * Snapshot rows are TRIMMED, not grid-padded (`xtermLineToChunks` drops
 * trailing blank cells), so a row's text can be shorter than the grid. The
 * mouse column, however, is clamped to the grid width — a drag can anchor in
 * the blank padding past a short line. When that happens on a multi-row
 * selection's FIRST row, its selected slice is empty. The loop only visits
 * rows within `[start.row, end.row]`, so a null span here always means "in
 * selection, empty slice" (rowSpan's out-of-range null can't occur inside
 * these bounds) — it must still contribute an empty line so the newline
 * survives, matching what `overlaySelection` highlights. Dropping it collapsed
 * two visibly-selected lines into one on copy.
 */
export function extractSelection(rows: readonly (readonly Chunk[])[], range: SelectionRange): string {
  const { start, end } = orderRange(range)
  const lines: string[] = []
  for (let r = Math.max(0, start.row); r <= Math.min(rows.length - 1, end.row); r++) {
    const text = rowText(rows[r] ?? [])
    const span = rowSpan(range, r, Math.max(textCells(text), 1))
    lines.push(span ? sliceTextByCells(text, span[0], span[1]).selected.trimEnd() : "")
  }
  return lines.join("\n")
}

/** Re-chunk one row so `[from, to)` renders inverse-video. */
function overlayRowSpan(row: readonly Chunk[], from: number, to: number): Chunk[] {
  const out: Chunk[] = []
  let col = 0
  for (const chunk of row) {
    const start = col
    const end = start + textCells(chunk.text)
    col = end
    if (end <= from || start >= to) {
      out.push(chunk)
      continue
    }
    const { before, selected, after } = sliceTextByCells(chunk.text, from - start, to - start)
    if (before) out.push({ ...chunk, text: before })
    out.push({ ...chunk, text: selected, attributes: (chunk.attributes ?? 0) | ATTR.INVERSE })
    if (after) out.push({ ...chunk, text: after })
  }
  // Selection reaching past the row's painted cells: show the highlight
  // on the padding too, like terminals do. When the span STARTS past the
  // painted cells (a drag anchored in the blank padding right of a short
  // line, `from > col`), the highlight must begin at `from`, not at the
  // row's painted width — so emit the `from - col` gap as plain spaces
  // first, then the inverse block. With `from <= col` the gap is zero and
  // the inverse block fills `[col, to)` exactly as before.
  if (col < to) {
    const gap = from - col
    if (gap > 0) out.push({ text: " ".repeat(gap) })
    out.push({ text: " ".repeat(to - Math.max(col, from)), attributes: ATTR.INVERSE })
  }
  return out
}

/* --------- alt-screen drag scrolling ---------- */

/**
 * An app that owns its own scrollback (an engine on the ALTERNATE screen) has
 * a one-screen snapshot: forwarding wheel ticks scrolls the APP, the content
 * shifts on screen, and the snapshot row numbers don't move. The pieces below
 * keep a drag-selection glued to the content anyway:
 *
 *  - `snapshotShift` MEASURES how far the content actually moved between two
 *    snapshots — the wheel only *asks* the app to scroll (`pty.wheel` reports
 *    "sequence sent", not "app moved N lines"), so the displacement has to be
 *    read back from what changed on screen.
 *  - `shiftShadow` banks the rows that scrolled off screen during the drag so
 *    the copy can include them; `extractShadowedSelection` extracts over the
 *    composed buffer through the SAME `extractSelection` path the highlight's
 *    range feeds — see-it = copy-it by construction.
 *
 * Coordinates stay snapshot-addressed: shadow rows live at logical indices
 * below 0 (`above`, top-first) and at `snapshotLength` and beyond (`below`).
 */
export type SelectionShadow = {
  /** Rows scrolled off the TOP, top-first: `above[i]` sits at logical index `i - above.length`. */
  readonly above: readonly (readonly Chunk[])[]
  /** Rows scrolled off the BOTTOM, contiguous: `below[0]` sits at logical index `snapshotLength`. */
  readonly below: readonly (readonly Chunk[])[]
}

export const EMPTY_SHADOW: SelectionShadow = { above: [], below: [] }

/** Rows banked per drag. ponytail: at the auto-scroll cap (~100 lines/s) this
 *  is ~20s of held drag; past it the anchor clamps instead of silently
 *  dropping middle rows. Raise if someone actually drags that long. */
export const SHADOW_ROW_CAP = 2000

/**
 * The vertical displacement of the content between two snapshots: positive
 * means the content moved DOWN on screen (`prev[i]` reappears at
 * `next[i + shift]`) — a scroll toward older content. 0 when nothing moved or
 * when no shift explains a majority of the non-blank rows it overlaps (a full
 * repaint, ambiguous repeated content): the conservative answer, leaving the
 * selection screen-fixed rather than guessing. Score ties resolve to the
 * smaller displacement, so screens of identical repeated rows — which "match"
 * at every shift, best at the largest overlap — settle on 0.
 */
export function snapshotShift(prev: readonly (readonly Chunk[])[], next: readonly (readonly Chunk[])[]): number {
  if (prev === next || prev.length === 0 || next.length === 0) return 0
  const prevText = prev.map(rowText)
  const nextText = next.map(rowText)
  const maxShift = Math.min(prev.length, next.length) - 1
  let best = 0
  let bestScore = -1
  let bestOverlap = 0
  for (let k = -maxShift; k <= maxShift; k++) {
    let score = 0
    let overlap = 0
    for (let i = 0; i < prevText.length; i++) {
      const j = i + k
      if (j < 0 || j >= nextText.length) continue
      const t = prevText[i] as string
      if (t.trim() === "") continue
      overlap++
      if (t === nextText[j]) score++
    }
    if (score > bestScore || (score === bestScore && Math.abs(k) < Math.abs(best))) {
      best = k
      bestScore = score
      bestOverlap = overlap
    }
  }
  // Two corroborating rows minimum: one lone matching row at some extreme
  // shift is far likelier to be a repaint coincidence than a real scroll.
  return bestScore > 1 && bestScore * 2 > bestOverlap ? best : 0
}

/**
 * Roll the shadow forward across one measured shift: bank the rows of
 * `previous` that just scrolled off screen, and drop shadow rows the app
 * re-revealed (a reversed drag) so they aren't extracted twice.
 */
export function shiftShadow(
  shadow: SelectionShadow,
  previous: readonly (readonly Chunk[])[],
  shift: number,
  cap = SHADOW_ROW_CAP,
): SelectionShadow {
  if (shift === 0) return shadow
  let above = shadow.above
  let below = shadow.below
  if (shift > 0) {
    // Content moved down: the last rows fell off the bottom; the nearest
    // above-shadow rows are back on screen.
    below = [...previous.slice(Math.max(0, previous.length - shift)), ...below]
    above = above.slice(0, Math.max(0, above.length - shift))
  } else {
    above = [...above, ...previous.slice(0, Math.min(previous.length, -shift))]
    below = below.slice(Math.min(below.length, -shift))
  }
  if (above.length > cap) above = above.slice(above.length - cap)
  if (below.length > cap) below = below.slice(0, cap)
  return { above, below }
}

/** Clamp a logical row to what the shadow can still address (the cap). */
export function clampRowToShadow(row: number, snapshotLength: number, shadow: SelectionShadow): number {
  return Math.min(snapshotLength - 1 + shadow.below.length, Math.max(0 - shadow.above.length, row))
}

/** Selection endpoints plus the shadow they address, rolled together. */
export type SelectionShiftState = {
  readonly anchor: CellPoint | null
  readonly head: CellPoint | null
  readonly shadow: SelectionShadow
}

/**
 * Roll a selection across one snapshot change: measure the content
 * displacement, bank the rows that scrolled off, and move the endpoints that
 * belong to the CONTENT along with it.
 *
 * While the drag is LIVE only the anchor follows — the head is pinned to the
 * pointer, which the pane re-derives from the last pointer position itself.
 * Once the drag is released both endpoints belong to the content, so both
 * follow and the highlight scrolls off the top or bottom of the pane the way
 * every emulator's does, instead of staying pinned to screen rows.
 *
 * Returns the input state by reference when there is nothing selected or no
 * shift is measurable, so callers can skip the update entirely.
 */
export function followContentShift(
  state: SelectionShiftState,
  prev: readonly (readonly Chunk[])[],
  next: readonly (readonly Chunk[])[],
  dragging: boolean,
): SelectionShiftState {
  if (!state.anchor) return state
  const shift = snapshotShift(prev, next)
  if (shift === 0) return state
  const shadow = shiftShadow(state.shadow, prev, shift)
  const follow = (cell: CellPoint | null): CellPoint | null =>
    cell ? { row: clampRowToShadow(cell.row + shift, next.length, shadow), col: cell.col } : cell
  return { anchor: follow(state.anchor), head: dragging ? state.head : follow(state.head), shadow }
}

/**
 * Extract over the composed drag buffer — shadow rows glued around the live
 * snapshot, the range translated into composed space. Same `extractSelection`
 * the shadow-free path uses; with an empty shadow this IS that path.
 */
export function extractShadowedSelection(
  snapshot: readonly (readonly Chunk[])[],
  shadow: SelectionShadow,
  range: SelectionRange,
): string {
  if (shadow.above.length === 0 && shadow.below.length === 0) return extractSelection(snapshot, range)
  const offset = shadow.above.length
  const rows = [...shadow.above, ...snapshot, ...shadow.below]
  return extractSelection(rows, {
    anchor: { row: range.anchor.row + offset, col: range.anchor.col },
    head: { row: range.head.row + offset, col: range.head.col },
  })
}

/**
 * Paint the selection over VIEWPORT rows. `firstRow` is the absolute
 * snapshot index of `rows[0]` (the viewport start), mapping the
 * absolute-addressed range onto the visible slice.
 */
export function overlaySelection(
  rows: readonly (readonly Chunk[])[],
  range: SelectionRange | null,
  firstRow: number,
  width: number,
): readonly (readonly Chunk[])[] {
  if (!range) return rows
  return rows.map((row, i) => {
    const span = rowSpan(range, firstRow + i, width)
    return span ? overlayRowSpan(row, span[0], span[1]) : row
  })
}

/**
 * Roll a selection across a snapshot-WINDOW move — the NORMAL screen's
 * counterpart to {@link followContentShift}.
 *
 * The local scrollback is bounded, so once it saturates every new line drops
 * one row off the front of the snapshot and every array index addresses
 * content one line newer than it did. `startLine` — the same absolute line id
 * `resolveViewportScrollOffset` re-derives the viewport from — states that
 * displacement exactly, so this is arithmetic, not the content matching
 * `snapshotShift` has to do for an app that owns its own scrollback.
 *
 * Rows the trim took are gone from local scrollback, so the endpoints clamp to
 * what is still addressable rather than being banked in the shadow (that bank
 * belongs to the alt-screen drag, where the rows still exist inside the app).
 *
 * Returns the input by reference when nothing moved, and `null` when line
 * numbering was RESET (a resize reflows history and bumps `epoch`): the
 * selection then addresses content that no longer exists under those ids and
 * must be dropped, not silently mis-mapped.
 */
export function followWindowShift(
  state: SelectionShiftState,
  prev: TerminalSnapshotWindow | null,
  next: TerminalSnapshotWindow | null,
  snapshotLength: number,
  dragging: boolean,
): SelectionShiftState | null {
  if (!state.anchor || !prev || !next) return state
  if (prev.epoch !== next.epoch) return null
  const delta = next.startLine - prev.startLine
  if (delta === 0) return state
  const follow = (cell: CellPoint): CellPoint => ({
    row: clampRowToShadow(cell.row - delta, snapshotLength, state.shadow),
    col: cell.col,
  })
  return {
    shadow: state.shadow,
    anchor: follow(state.anchor),
    // The head belongs to the POINTER while the drag is live — the pane
    // re-derives it from the last pointer position itself.
    head: dragging || !state.head ? state.head : follow(state.head),
  }
}
