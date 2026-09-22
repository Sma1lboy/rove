/**
 * Grid-based selection for the embedded terminal pane. opentui's text-flow
 * selection can't work here: the snapshot <text> is replaced on every PTY
 * frame, invalidating flow anchors mid-drag.
 *
 * Pure and cell-addressed: anchor/head are ABSOLUTE snapshot coordinates
 * (row = snapshot row index, col = terminal column), normalized to
 * xterm/tmux reading-order spans (first row from start col, middle rows
 * whole, last row to end col). The highlight is painted per frame by
 * `overlaySelection`, so it survives snapshot refreshes.
 */

import { charWidth } from "../../../lib/display-width"
import type { TerminalSnapshotWindow } from "./pty-types"
import { ATTR, type Chunk, type RGB } from "./sgr"
import { type RowWrapFlags, isWrapContinuation } from "./terminal-wrap"

export type CellPoint = { readonly row: number; readonly col: number }
export type SelectionRange = { readonly anchor: CellPoint; readonly head: CellPoint }

/**
 * The absolute snapshot cell under a pointer, plus the auto-scroll pull it
 * asks for.
 *
 * `viewCol`/`viewRow` are pane-relative and may be negative or past the last
 * row: opentui captures the drag to the pressed element, so a drag leaving
 * the pane keeps reporting real coordinates.
 *
 * `edgePull` counts from the EDGE ROW (first visible row pulls 1, one above
 * pulls 2; mirrored at the bottom): the pane sits flush under a one-row tab
 * strip, so "beyond the pane" is a target the pointer rarely hits. The cell
 * is always a valid snapshot address (col clamped to grid, row to snapshot);
 * since it's absolute, a stationary pointer's row changes as the viewport
 * scrolls, which is what lets a held drag extend into scrollback.
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
 * Snapshot rows are TRIMMED (`xtermLineToChunks` drops trailing blanks) but
 * the mouse column is clamped to the grid, so a drag can anchor past a short
 * line and yield an empty slice. Inside `[start.row, end.row]` a null span
 * always means "selected, empty": it still contributes an empty line so the
 * newline survives, matching what `overlaySelection` highlights.
 */
export function extractSelection(
  rows: readonly (readonly Chunk[])[],
  range: SelectionRange,
  wrapped?: RowWrapFlags,
): string {
  const { start, end } = orderRange(range)
  const first = Math.max(0, start.row)
  const lines: string[] = []
  for (let r = first; r <= Math.min(rows.length - 1, end.row); r++) {
    const text = rowText(rows[r] ?? [])
    const span = rowSpan(range, r, Math.max(textCells(text), 1))
    const slice = span ? sliceTextByCells(text, span[0], span[1]).selected : ""
    // A soft-wrap continuation appends to the same logical line; the first
    // selected row always opens one, since its predecessor is outside.
    if (r > first && isWrapContinuation(wrapped, r) && lines.length > 0) lines[lines.length - 1] += slice
    else lines.push(slice)
  }
  // Trim per LOGICAL line: a wrap point is mid-line, padding is at its end.
  return lines.map((line) => line.trimEnd()).join("\n")
}

/**
 * How {@link overlaySelection} repaints covered cells. `"inverse"` XORs the
 * inverse attribute (the pane selection, readable over any colors); a flat
 * `{fg,bg}` overrides colors, for the search's current hit, which would be
 * indistinguishable from the other inverse hits.
 */
export type SpanPaint = "inverse" | { readonly fg: RGB; readonly bg: RGB }

/** Apply `paint` to one chunk's worth of covered text. */
function paintChunk(chunk: Chunk, text: string, paint: SpanPaint): Chunk {
  if (paint === "inverse") return { ...chunk, text, attributes: (chunk.attributes ?? 0) ^ ATTR.INVERSE }
  return { ...chunk, text, fg: paint.fg, bg: paint.bg }
}

/** Re-chunk one row so `[from, to)` renders in `paint`. */
function overlayRowSpan(row: readonly Chunk[], from: number, to: number, paint: SpanPaint): Chunk[] {
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
    out.push(paintChunk(chunk, selected, paint))
    if (after) out.push({ ...chunk, text: after })
  }
  // Highlight the padding past the painted cells too, like terminals do. A
  // span starting past them (`from > col`) begins at `from`: emit the gap as
  // plain spaces, then the painted block.
  if (col < to) {
    const gap = from - col
    if (gap > 0) out.push({ text: " ".repeat(gap) })
    out.push(paintChunk({ text: "" }, " ".repeat(to - Math.max(col, from)), paint))
  }
  return out
}

/* --------- alt-screen drag scrolling ---------- */

/**
 * An app on the ALTERNATE screen owns its scrollback: the snapshot is one
 * screen, wheel ticks scroll the APP, and row numbers don't move. To keep a
 * drag-selection glued to content:
 *
 *  - `snapshotShift` MEASURES the displacement from what changed on screen;
 *    `pty.wheel` only reports "sequence sent", not "app moved N lines".
 *  - `shiftShadow` banks rows scrolled off during the drag;
 *    `extractShadowedSelection` extracts them through the same
 *    `extractSelection` path, so what's highlighted is what's copied.
 *
 * Shadow rows sit at logical indices below 0 (`above`, top-first) and at
 * `snapshotLength` and beyond (`below`).
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
const SHADOW_ROW_CAP = 2000

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
 * Roll a selection across one snapshot change: measure the shift, bank rows
 * that scrolled off, and move content-owned endpoints with it. During a live
 * drag only the anchor follows (the pane re-derives the head from the
 * pointer); after release both follow, so the highlight scrolls with content.
 *
 * Returns the input by reference when nothing is selected or no shift is
 * measurable, so callers can skip the update.
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
  wrapped?: RowWrapFlags,
): string {
  if (shadow.above.length === 0 && shadow.below.length === 0) return extractSelection(snapshot, range, wrapped)
  const offset = shadow.above.length
  const rows = [...shadow.above, ...snapshot, ...shadow.below]
  // Shadow rows come from an ALT-screen app that positions each row itself
  // (no emulator wrap), so they count as line starts.
  const shifted = wrapped
    ? [...new Array<boolean>(offset).fill(false), ...wrapped, ...new Array<boolean>(shadow.below.length).fill(false)]
    : undefined
  return extractSelection(
    rows,
    {
      anchor: { row: range.anchor.row + offset, col: range.anchor.col },
      head: { row: range.head.row + offset, col: range.head.col },
    },
    shifted,
  )
}

/**
 * Whether the PTY app just TOOK the mouse, so the pane's selection must yield.
 *
 * A mouse-tracking app (claude, vim, htop, less) owns its own selection; a
 * second highlight over it is always wrong and neither layer can clear the
 * other's. Forwarded presses already keep the pane out (`encodeMouseButton`
 * is null only while tracking is `none`; `Terminal.tsx` selects only on an
 * unforwarded press); this covers the app arriving afterwards (`vim`
 * launched with text highlighted or mid-drag).
 *
 * RISING EDGE only: a selection begun while the app already owned the mouse
 * is the deliberate shift bypass (iTerm/kitty escape hatch) and must survive.
 */
export function appTookMouse(previouslyOwned: boolean, ownedNow: boolean): boolean {
  return ownedNow && !previouslyOwned
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
  paint: SpanPaint = "inverse",
): readonly (readonly Chunk[])[] {
  if (!range) return rows
  return rows.map((row, i) => {
    const span = rowSpan(range, firstRow + i, width)
    return span ? overlayRowSpan(row, span[0], span[1], paint) : row
  })
}

/**
 * Roll a selection across a snapshot-WINDOW move, the NORMAL screen's
 * counterpart to {@link followContentShift}.
 *
 * Saturated local scrollback drops a row off the front per new line, so
 * indices drift. `startLine` (the absolute line id
 * `resolveViewportScrollOffset` also uses) gives the exact displacement, no
 * content matching needed. Trimmed rows are gone, so endpoints clamp rather
 * than being banked in the shadow (the shadow is for alt-screen drags, where
 * the rows still exist inside the app).
 *
 * Returns the input by reference when nothing moved; `null` when numbering
 * was RESET (resize reflow bumps `epoch`), since the ids then address
 * different content and the selection must be dropped, not mis-mapped.
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
    // A live drag's head belongs to the pointer.
    head: dragging || !state.head ? state.head : follow(state.head),
  }
}
