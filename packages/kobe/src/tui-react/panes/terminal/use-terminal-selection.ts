/**
 * Copy-on-select, GRID-based selection for the embedded terminal pane —
 * React port of the selection half of `tui/panes/terminal/Terminal.tsx`
 * (tmux convention; see `terminal-selection.ts` for why opentui's text-flow
 * selection can't work over this pane). Split out purely to keep
 * `Terminal.tsx` under the file-size cap.
 *
 * Anchor and head live in ABSOLUTE snapshot coordinates so the highlight
 * survives every frame refresh and scrollback move. A ZERO-WIDTH selection
 * (a plain click, before any drag) resolves to `null` — rendering no
 * highlight and, more importantly, keeping `selection` reference-stable
 * across a click so the snapshot content isn't re-pushed for nothing (the
 * whole-pane twitch-on-click the Solid original called out).
 *
 * `isDragging` is a plain ref, not state: it flips on every mouse-move
 * during a drag, and mirroring that into React state would re-render the
 * pane on every pixel of drag motion for no visible benefit.
 *
 * A drag held at (or past) the pane's top or bottom EDGE ROW auto-scrolls the
 * viewport, the way every terminal emulator does — without it the selection
 * can never reach a row that is already above the first visible one. The pull
 * starts at the boundary row itself because the pane sits flush under a
 * one-row tab strip: "past the edge" is a target the pointer rarely hits. It
 * only pulls in the direction the selection is actually growing, so dragging
 * sideways along the first row (anchor on that row) never scrolls. Each tick
 * only scrolls; the head is re-derived from the last pointer position
 * whenever the viewport moves, so it follows the scroll exactly and a wheel
 * tick mid-drag extends the selection too.
 */

import type { BoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { copyTextToSystemClipboard } from "../../../tui/lib/clipboard-copy"
import type { TerminalRow } from "../../../tui/panes/terminal/pty"
import {
  type CellPoint,
  type SelectionRange,
  extractSelection,
  pointerCell,
} from "../../../tui/panes/terminal/terminal-selection"

export type { CellPoint, SelectionRange } from "../../../tui/panes/terminal/terminal-selection"

/** Auto-scroll cadence while a drag hangs past an edge, and its per-tick cap. */
const AUTO_SCROLL_MS = 50
const AUTO_SCROLL_MAX_LINES = 5

export interface UseTerminalSelectionOpts {
  bodyEl: BoxRenderable | null
  bodyGeometry: { cols: number; rows: number } | null
  bodyRows: number
  /** Absolute snapshot row index of the first VISIBLE row (viewport start). */
  visibleRangeStart: number
  snapshot: readonly TerminalRow[]
  /** Move the viewport: negative scrolls up into history, positive toward live. */
  scrollBy: (lines: number) => void
}

export interface UseTerminalSelectionResult {
  selection: SelectionRange | null
  /** Map a mouse event's screen coords to absolute (row, col) snapshot coordinates. */
  cellFromEvent: (evt: { x?: number; y?: number }) => CellPoint | null
  beginSelection: (cell: CellPoint) => void
  /** Extend the selection to a drag position, auto-scrolling past the edges. */
  dragTo: (evt: { x?: number; y?: number }) => void
  isDragging: () => boolean
  endDragging: () => void
  clearSelection: () => void
  copySelection: () => void
}

export function useTerminalSelection(opts: UseTerminalSelectionOpts): UseTerminalSelectionResult {
  const [selAnchor, setSelAnchor] = useState<CellPoint | null>(null)
  const [selHead, setSelHead] = useState<CellPoint | null>(null)
  const draggingRef = useRef(false)
  const anchorRef = useRef<CellPoint | null>(null)
  const renderer = useRenderer()

  const selection = useMemo<SelectionRange | null>(() => {
    if (!selAnchor || !selHead) return null
    if (selAnchor.row === selHead.row && selAnchor.col === selHead.col) return null
    return { anchor: selAnchor, head: selHead }
  }, [selAnchor, selHead])

  const resolvePointer = (evt: { x?: number; y?: number }): { cell: CellPoint; edgePull: number } | null => {
    const { bodyEl: body, bodyGeometry: geometry, bodyRows, visibleRangeStart, snapshot } = opts
    if (!body || !geometry) return null
    return pointerCell(
      (evt.x ?? 0) - body.screenX,
      (evt.y ?? 0) - body.screenY,
      { cols: geometry.cols, rows: bodyRows },
      visibleRangeStart,
      snapshot.length,
    )
  }

  const cellFromEvent = (evt: { x?: number; y?: number }): CellPoint | null => resolvePointer(evt)?.cell ?? null

  const beginSelection = (cell: CellPoint): void => {
    draggingRef.current = true
    // Mirrored into a ref as well: the drag events of a fast gesture land
    // before React has re-rendered with the new anchor, and the auto-scroll
    // direction check must not read a stale (null) one.
    anchorRef.current = cell
    setSelAnchor(cell)
    setSelHead(cell)
  }

  /* --------- drag + edge auto-scroll ---------- */

  // The last pointer position of the live drag, in absolute screen coords —
  // the auto-scroll tick and the post-scroll head refresh both re-read it.
  const dragPointRef = useRef<{ x: number; y: number } | null>(null)
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The tick closes over render-derived geometry, so it's refreshed after
  // every render rather than captured once when the interval starts.
  const tickRef = useRef<() => void>(() => {})

  const stopAutoScroll = (): void => {
    if (!autoScrollRef.current) return
    clearInterval(autoScrollRef.current)
    autoScrollRef.current = null
  }

  /**
   * The pull only counts when the selection is GROWING that way: at the
   * boundary row the pointer is still inside the pane, so a sideways drag
   * along the first row (anchor on that row) must not drag the viewport with
   * it. Once the pointer is genuinely past the edge, the head is already
   * beyond the anchor and this is satisfied by construction.
   */
  const pullFor = (at: { cell: CellPoint; edgePull: number }, anchor: CellPoint | null): number => {
    if (at.edgePull === 0 || !anchor) return 0
    if (at.edgePull < 0) return at.cell.row < anchor.row ? at.edgePull : 0
    return at.cell.row > anchor.row ? at.edgePull : 0
  }

  const dragTo = (evt: { x?: number; y?: number }): void => {
    if (!draggingRef.current) return
    const at = resolvePointer(evt)
    if (!at) return
    dragPointRef.current = { x: evt.x ?? 0, y: evt.y ?? 0 }
    setSelHead(at.cell)
    if (pullFor(at, anchorRef.current) === 0) stopAutoScroll()
    else if (!autoScrollRef.current) autoScrollRef.current = setInterval(() => tickRef.current(), AUTO_SCROLL_MS)
  }

  useEffect(() => {
    tickRef.current = () => {
      const point = dragPointRef.current
      const at = point && draggingRef.current ? resolvePointer(point) : null
      const pull = at ? pullFor(at, anchorRef.current) : 0
      if (pull === 0) {
        stopAutoScroll()
        return
      }
      // Speed follows how far past the edge the pointer is, capped so a drag
      // to the edge of the screen doesn't fly through the whole scrollback.
      opts.scrollBy(Math.max(-AUTO_SCROLL_MAX_LINES, Math.min(AUTO_SCROLL_MAX_LINES, pull)))
    }
  })

  // Whenever the viewport moves under a live drag, the pointer is over a
  // different absolute row — re-derive the head so the highlight keeps up
  // with the scroll instead of trailing it by a tick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on viewport moves; the pointer is a ref and the resolver is re-made per render.
  useEffect(() => {
    if (!draggingRef.current) return
    const point = dragPointRef.current
    const at = point ? resolvePointer(point) : null
    if (at) setSelHead(at.cell)
  }, [opts.visibleRangeStart])

  // Unmount mid-drag (tab closed, pane swapped) must not leave a timer behind.
  useEffect(
    () => () => {
      if (autoScrollRef.current) clearInterval(autoScrollRef.current)
    },
    [],
  )

  const copySelection = (): void => {
    if (!selection) return
    const text = extractSelection(opts.snapshot, selection)
    if (text.trim().length > 0) copyTextToSystemClipboard(text, (payload) => renderer?.copyToClipboardOSC52(payload))
  }

  return {
    selection,
    cellFromEvent,
    beginSelection,
    dragTo,
    isDragging: () => draggingRef.current,
    endDragging: () => {
      draggingRef.current = false
      dragPointRef.current = null
      stopAutoScroll()
    },
    clearSelection: () => {
      anchorRef.current = null
      setSelAnchor(null)
      setSelHead(null)
    },
    copySelection,
  }
}
