/**
 * Body-box geometry for the terminal pane, measured BEFORE the PTY exists so
 * a fresh pane boots at its real size (booting at 80x24 then resizing makes
 * zsh/starship prompts redraw into stray lines). Nothing here may depend on
 * the PTY handle or viewport cursor (`use-terminal-host-cursor.ts` owns
 * those effects).
 *
 * `bodyEl` MUST be React state, not a ref, so the effect re-runs the instant
 * the box attaches. The caller's ref callback MUST be an inline arrow, not
 * the stable `setBodyEl`: its re-attach every render is what re-measures
 * after Yoga's first pass (the first attach reports 0x0). A stable ref left
 * three Terminal render tests with no PTY; re-measuring on the frame event, a
 * 0/16ms timer, or one forced post-mount render all land too late.
 */

import type { BoxRenderable } from "@opentui/core"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTerminalSize } from "../../lib/use-terminal-size"

export interface UseTerminalGeometryResult {
  bodyEl: BoxRenderable | null
  setBodyEl: (el: BoxRenderable | null) => void
  bodyRows: number
  bodyGeometry: { cols: number; rows: number } | null
  bumpGeomTick: () => void
  /** Live host-terminal dims, so callers needn't subscribe again. */
  dims: { width: number; height: number }
  /** Layout-tick bumped by the body box's `onSizeChange` — see header. */
  geomTick: number
}

export function useTerminalGeometry(): UseTerminalGeometryResult {
  const [bodyEl, setBodyElState] = useState<BoxRenderable | null>(null)
  const bodyElRef = useRef<BoxRenderable | null>(null)
  const [bodyRows, setBodyRows] = useState(4)
  const [bodyGeometry, setBodyGeometry] = useState<{ cols: number; rows: number } | null>(null)
  const dims = useTerminalSize()

  const setBodyEl = useCallback((el: BoxRenderable | null): void => {
    bodyElRef.current = el
    setBodyElState(el)
  }, [])

  const measure = useCallback((el: BoxRenderable): void => {
    // Pre-layout the box reports 0 (or junk); pushing a floored size makes the engine redraw tiny.
    if (el.width <= 0 || el.height <= 0) return
    const cols = Math.max(20, el.width)
    const rows = Math.max(4, el.height)
    setBodyRows(rows)
    setBodyGeometry((cur) => (cur && cur.cols === cols && cur.rows === rows ? cur : { cols, rows }))
  }, [])

  // Bumped by `onSizeChange`: catches layout changes with no React state (splitter drags).
  // Measuring here too puts the new size in the same commit as the tick.
  const [geomTick, setGeomTick] = useState(0)
  const bumpGeomTick = useCallback((): void => {
    setGeomTick((n) => (n + 1) & 0xff)
    if (bodyElRef.current) measure(bodyElRef.current)
  }, [measure])

  useEffect(() => {
    // Invalidation keys only: geometry is read imperatively off `bodyEl`.
    void dims
    void geomTick
    if (bodyEl) measure(bodyEl)
  }, [bodyEl, dims, geomTick, measure])

  return { bodyEl, setBodyEl, bodyRows, bodyGeometry, bumpGeomTick, dims, geomTick }
}
