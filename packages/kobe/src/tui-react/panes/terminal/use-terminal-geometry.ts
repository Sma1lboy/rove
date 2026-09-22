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
import { useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useState } from "react"

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
  const [bodyEl, setBodyEl] = useState<BoxRenderable | null>(null)
  const [bodyRows, setBodyRows] = useState(4)
  const [bodyGeometry, setBodyGeometry] = useState<{ cols: number; rows: number } | null>(null)
  const dims = useTerminalDimensions()

  // Bumped by `onSizeChange`: catches layout changes with no React state (splitter drags).
  const [geomTick, setGeomTick] = useState(0)
  const bumpGeomTick = useCallback((): void => {
    setGeomTick((n) => (n + 1) & 0xff)
  }, [])

  useEffect(() => {
    // Invalidation keys only: geometry is read imperatively off `bodyEl`.
    void dims
    void geomTick
    if (!bodyEl) return
    // Pre-layout the box reports 0 (or junk); pushing a floored size makes the engine redraw tiny.
    if (bodyEl.width <= 0 || bodyEl.height <= 0) return
    const cols = Math.max(20, bodyEl.width)
    const rows = Math.max(4, bodyEl.height)
    setBodyRows(rows)
    setBodyGeometry((cur) => (cur && cur.cols === cols && cur.rows === rows ? cur : { cols, rows }))
  }, [bodyEl, dims, geomTick])

  return { bodyEl, setBodyEl, bodyRows, bodyGeometry, bumpGeomTick, dims, geomTick }
}
