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
 *
 * When the scroll was FORWARDED to an app that owns its own scrollback (an
 * engine on the alternate screen), the viewport never moves — the app redraws
 * and the content shifts under snapshot row numbers that stay put. While a
 * SELECTION EXISTS — during the drag and after the release, until the next
 * click clears it — every snapshot change is measured with `snapshotShift` and
 * the endpoints move with the content (`followContentShift`); the rows that
 * scrolled off screen are banked in a bounded shadow so the copy contains
 * exactly what the highlight covered. During the drag only the anchor follows,
 * because the head belongs to the pointer.
 *
 * On the NORMAL screen the displacement is known rather than measured: kobe's
 * own scrollback is bounded, so a saturated buffer drops one row off the front
 * per new line and `snapshotWindow.startLine` — the absolute line id the
 * viewport is already anchored to — gives the exact offset to translate the
 * endpoints by.
 */

import type { BoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { copyTextToSystemClipboard } from "../../../tui/lib/clipboard-copy"
import type { TerminalRow } from "../../../tui/panes/terminal/pty"
import type { TerminalSnapshotWindow } from "../../../tui/panes/terminal/pty-types"
import {
  type CellPoint,
  EMPTY_SHADOW,
  type SelectionRange,
  type SelectionShadow,
  type SelectionShiftState,
  extractShadowedSelection,
  followContentShift,
  followWindowShift,
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
  /**
   * Absolute line id of `snapshot[0]`, or null when the backend can't number
   * lines (alternate screen, or no scrollback yet). A bounded scrollback trims
   * from the front, so this is what keeps the selection on its content.
   */
  snapshotWindow: TerminalSnapshotWindow | null
  /**
   * Scroll for a drag hanging past an edge: negative goes up into history,
   * positive toward live. The pointer's absolute coords come along because the
   * pane may have to forward wheel ticks to an app that owns its own
   * scrollback (an engine on the alternate screen has no local scrollback).
   * Returns true when the scroll was forwarded to the app that way — the cue
   * to start measuring content shifts against the snapshot.
   */
  scrollBy: (lines: number, screenX: number, screenY: number) => boolean
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
  /** The pane forwarded a wheel to the app (outside the edge pull). */
  noteAppScroll: () => void
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

  /**
   * opentui only starts capturing a drag on the FIRST drag event, routed by hit
   * test — a gesture whose first move already lands outside the pane (a fast
   * drag, or a press on the top row moving up into the tab strip) hands the
   * whole drag to whatever sits under the pointer, and this pane never hears
   * about it again. So claim the capture on PRESS. `setCapturedRenderable` is
   * TS-private, not runtime-private.
   * ponytail: reaching into it beats re-implementing opentui's dispatch; if it
   * ever goes away, the fallback is a root-level drag listener.
   */
  const captureDrag = (el: BoxRenderable | null): void => {
    ;(renderer as unknown as { setCapturedRenderable?: (r: unknown) => void })?.setCapturedRenderable?.(el ?? undefined)
  }

  const beginSelection = (cell: CellPoint): void => {
    draggingRef.current = true
    captureDrag(opts.bodyEl)
    appScrolledRef.current = false
    shadowRef.current = EMPTY_SHADOW
    lastSnapshotRef.current = opts.snapshot
    lastWindowRef.current = opts.snapshotWindow
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
  // App-owned scrolling (alt-screen engines): set once a wheel was forwarded
  // during this drag; from then on snapshot changes are measured and the
  // anchor + shadow follow the content. All reset by the next beginSelection.
  const appScrolledRef = useRef(false)
  const shadowRef = useRef<SelectionShadow>(EMPTY_SHADOW)
  const lastSnapshotRef = useRef(opts.snapshot)
  const lastWindowRef = useRef(opts.snapshotWindow)
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The tick closes over render-derived geometry, so it's refreshed after
  // every render rather than captured once when the interval starts.
  const tickRef = useRef<() => void>(() => {})

  const clearSelectionState = (): void => {
    anchorRef.current = null
    appScrolledRef.current = false
    shadowRef.current = EMPTY_SHADOW
    setSelAnchor(null)
    setSelHead(null)
  }

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
      if (pull === 0 || !point) {
        stopAutoScroll()
        return
      }
      // Speed follows how far past the edge the pointer is, capped so a drag
      // to the edge of the screen doesn't fly through the whole scrollback.
      const capped = Math.max(-AUTO_SCROLL_MAX_LINES, Math.min(AUTO_SCROLL_MAX_LINES, pull))
      if (opts.scrollBy(capped, point.x, point.y)) appScrolledRef.current = true
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

  const applyShift = (rolled: SelectionShiftState): void => {
    shadowRef.current = rolled.shadow
    anchorRef.current = rolled.anchor
    setSelAnchor(rolled.anchor)
    setSelHead(rolled.head)
  }

  // Two ways the content can move out from under a selection, and they are
  // mutually exclusive by which layer owns the scrollback:
  //
  //  - NORMAL screen: kobe owns a BOUNDED scrollback, so once it saturates
  //    every new line drops one row off the front and each array index means
  //    content one line newer. `snapshotWindow.startLine` states that
  //    displacement exactly (`followWindowShift`) — no matching needed.
  //  - ALTERNATE screen: the app owns its scrollback, the viewport never moves
  //    and there is no window to number lines with, so the shift has to be read
  //    back off the content (`followContentShift`) and the rows that scrolled
  //    off banked in the shadow so the copy still has them.
  //
  // The content measurement only runs when the window did NOT move: a trim
  // already fully explains the array-coordinate displacement, and re-deriving
  // it would apply the same shift twice. It stays gated on a wheel having been
  // forwarded, because it is an O(rows^2) text comparison that must not run on
  // every PTY frame for nothing — and on a selection EXISTING rather than on a
  // live drag, because a released selection still belongs to its content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on snapshot pushes; `selHead` is read from the render that pushed them.
  useEffect(() => {
    const prevSnapshot = lastSnapshotRef.current
    const prevWindow = lastWindowRef.current
    lastSnapshotRef.current = opts.snapshot
    lastWindowRef.current = opts.snapshotWindow
    if (!anchorRef.current) return
    const state: SelectionShiftState = { anchor: anchorRef.current, head: selHead, shadow: shadowRef.current }
    const windowed = followWindowShift(
      state,
      prevWindow,
      opts.snapshotWindow,
      opts.snapshot.length,
      draggingRef.current,
    )
    // Line numbering was reset (a resize reflows history): the selection
    // addresses content that no longer exists under those ids.
    if (!windowed) {
      clearSelectionState()
      return
    }
    if (windowed !== state) {
      applyShift(windowed)
      return
    }
    if (!appScrolledRef.current || prevSnapshot === opts.snapshot) return
    applyShift(followContentShift(state, prevSnapshot, opts.snapshot, draggingRef.current))
  }, [opts.snapshot, opts.snapshotWindow])

  // Unmount mid-drag (tab closed, pane swapped) must not leave a timer behind.
  useEffect(
    () => () => {
      if (autoScrollRef.current) clearInterval(autoScrollRef.current)
    },
    [],
  )

  const copySelection = (): void => {
    if (!selection) return
    const text = extractShadowedSelection(opts.snapshot, shadowRef.current, selection)
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
      captureDrag(null)
      dragPointRef.current = null
      stopAutoScroll()
    },
    clearSelection: clearSelectionState,
    copySelection,
    noteAppScroll: () => {
      // Armed by a selection, not by a drag — a wheel AFTER the release has to
      // start the measuring too, or the highlight stops following its content.
      if (anchorRef.current) appScrolledRef.current = true
    },
  }
}
