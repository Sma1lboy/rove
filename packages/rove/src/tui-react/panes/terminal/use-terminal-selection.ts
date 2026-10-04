/**
 * Copy-on-select GRID selection for the terminal pane (`terminal-selection.ts`
 * says why opentui's text-flow selection can't work here).
 *
 * Anchor/head are ABSOLUTE snapshot coordinates. A ZERO-WIDTH selection (a
 * plain click) resolves to `null`, keeping `selection` reference-stable so
 * the snapshot isn't re-pushed (a re-push twitches the pane). `isDragging` is
 * a ref: as state it would re-render on every pixel of drag.
 *
 * A drag at (or past) the top/bottom EDGE ROW auto-scrolls. The pull starts
 * at the boundary row because the pane sits flush under a one-row tab strip,
 * and only in the direction the selection grows. Ticks only scroll; the head
 * is re-derived from the last pointer position whenever the viewport moves.
 *
 * FORWARDED scrolls (alt-screen engines) never move the viewport: while a
 * selection EXISTS, each snapshot change is measured (`snapshotShift`) and the
 * endpoints follow the content (`followContentShift`), with scrolled-off rows
 * banked in a bounded shadow so the copy matches the highlight. Mid-drag only
 * the anchor follows; the head belongs to the pointer. On the NORMAL screen
 * the shift is known: `snapshotWindow.startLine` gives the exact offset.
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
  appTookMouse,
  extractShadowedSelection,
  followContentShift,
  followWindowShift,
  pointerCell,
} from "../../../tui/panes/terminal/terminal-selection"
import type { RowWrapFlags } from "../../../tui/panes/terminal/terminal-wrap"
import { useOptionalNotifications } from "../../context/notifications"
import { useT } from "../../i18n"

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
  /** Absolute line id of `snapshot[0]`; null when lines can't be numbered
   *  (alternate screen, no scrollback yet). Keeps a trimmed selection on its content. */
  snapshotWindow: TerminalSnapshotWindow | null
  /** Soft-wrap flags parallel to `snapshot`: a copied logical line must not
   *  grow the newlines the emulator's column limit put on screen. */
  wrapped: RowWrapFlags
  /** Edge-drag scroll (negative = history). Coords come along for forwarding to
   *  an app that owns its scrollback; true = forwarded, start measuring shifts. */
  scrollBy: (lines: number, screenX: number, screenY: number) => boolean
  /**
   * The PTY app has mouse tracking on (see {@link appTookMouse}). Re-read
   * every render.
   * ponytail: an app that enabled tracking and drew NOTHING goes unnoticed
   * until its next output; vim/claude/less always repaint on entry.
   */
  appOwnsMouse: boolean
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
  const notifications = useOptionalNotifications()
  const t = useT()

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
   * Claim the drag capture on PRESS: opentui captures on the first drag
   * event by hit test, so a fast first move outside the pane loses the drag.
   * `setCapturedRenderable` is TS-private, not runtime-private.
   * ponytail: if it ever goes away, fall back to a root-level drag listener.
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
    // Also a ref: a fast gesture's drag events land before the re-render.
    anchorRef.current = cell
    setSelAnchor(cell)
    setSelHead(cell)
  }

  /* --------- drag + edge auto-scroll ---------- */

  // Last pointer position (absolute screen coords) of the live drag.
  const dragPointRef = useRef<{ x: number; y: number } | null>(null)
  // Set once a wheel is forwarded; reset by the next beginSelection.
  const appScrolledRef = useRef(false)
  const shadowRef = useRef<SelectionShadow>(EMPTY_SHADOW)
  const lastSnapshotRef = useRef(opts.snapshot)
  const lastWindowRef = useRef(opts.snapshotWindow)
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Refreshed every render: the tick reads render-derived geometry.
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

  const stopDragging = (): void => {
    draggingRef.current = false
    captureDrag(null)
    dragPointRef.current = null
    stopAutoScroll()
  }

  /** The pull counts only when the selection GROWS that way, so a sideways
   *  drag along the boundary row doesn't scroll. */
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
      // Speed scales with distance past the edge, capped.
      const capped = Math.max(-AUTO_SCROLL_MAX_LINES, Math.min(AUTO_SCROLL_MAX_LINES, pull))
      if (opts.scrollBy(capped, point.x, point.y)) appScrolledRef.current = true
    }
  })

  // Viewport moved under a live drag: re-derive the head so it doesn't trail a tick.
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

  // NORMAL screen: a saturated bounded scrollback shifts by exactly the
  // `startLine` delta (`followWindowShift`). ALTERNATE screen: the shift is
  // read off the content (`followContentShift`), only when the window did NOT
  // move (else the shift applies twice), only after a forwarded wheel (it is
  // O(rows^2)), and while a selection EXISTS (a released one still follows).
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
    // Numbering reset (resize reflow): the selection's content is gone.
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

  // The app TAKING the mouse ends the pane's selection (else two stacked
  // highlights, and a live drag extending inside the app). Edge-triggered: a
  // shift-drag begun while the app already owned the mouse keeps its highlight.
  const appOwnedMouseRef = useRef(opts.appOwnsMouse)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ownership flip alone; the two teardown helpers are re-made every render and listing them would re-run this on every frame.
  useEffect(() => {
    const took = appTookMouse(appOwnedMouseRef.current, opts.appOwnsMouse)
    appOwnedMouseRef.current = opts.appOwnsMouse
    if (!took) return
    stopDragging()
    clearSelectionState()
  }, [opts.appOwnsMouse])

  // Unmount mid-drag must not leave a timer behind.
  useEffect(
    () => () => {
      if (autoScrollRef.current) clearInterval(autoScrollRef.current)
    },
    [],
  )

  /**
   * Copy-on-release: success is SILENT, failure toasts. Whitespace-only
   * selections are skipped, not copied over the clipboard.
   * ponytail: with NEITHER clipboard channel this toasts once per drag; it's
   * a one-time machine fix, so no suppression cache.
   */
  const copySelection = (): void => {
    if (!selection) return
    const text = extractShadowedSelection(opts.snapshot, shadowRef.current, selection, opts.wrapped)
    if (text.trim().length === 0) return
    void copyTextToSystemClipboard(text, (payload) => renderer?.copyToClipboardOSC52(payload)).then((copied) => {
      // Empty task/tab ids: toast only, no unread badge.
      if (!copied) notifications?.notify({ kind: "error", taskId: "", tabId: "", title: t("tasks.toast.copyFailed") })
    })
  }

  return {
    selection,
    cellFromEvent,
    beginSelection,
    dragTo,
    isDragging: () => draggingRef.current,
    endDragging: stopDragging,
    clearSelection: clearSelectionState,
    copySelection,
    noteAppScroll: () => {
      // Armed by a selection, not a drag: a wheel after release must measure too.
      if (anchorRef.current) appScrolledRef.current = true
    },
  }
}
