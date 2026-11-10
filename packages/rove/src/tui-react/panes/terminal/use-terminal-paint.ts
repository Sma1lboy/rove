/**
 * The terminal pane's paint pipeline: visible snapshot rows + the overlays
 * that sit on them (selection, cursor) → retained row buffers.
 */

import { profileSpan } from "@/lib/render-profile"
import type { BoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useLayoutEffect, useMemo, useState } from "react"
import type { TerminalRow } from "../../../tui/panes/terminal/pty"
import { type TerminalRenderColors, overlayCursor } from "../../../tui/panes/terminal/terminal-render"
import { type SelectionRange, overlaySelection } from "../../../tui/panes/terminal/terminal-selection"
import { TerminalRowPainter } from "./terminal-row-painter"

export interface UseTerminalPaintOpts {
  readonly visibleRows: readonly TerminalRow[]
  /** Absolute snapshot row index of the first visible row. */
  readonly firstRow: number
  readonly cols: number
  readonly selection: SelectionRange | null
  /** Viewport-relative cursor, or null when there is none to draw. */
  readonly cursor: { x: number; y: number } | null
  readonly focused: boolean
  readonly colors: TerminalRenderColors
}

/** Ref callback for the grid whose row buffers the painter owns. */
export function useTerminalPaint(opts: UseTerminalPaintOpts): (el: BoxRenderable | null) => void {
  const { visibleRows, firstRow, cols, selection, cursor, focused, colors } = opts
  const renderer = useRenderer()

  const cursorRows = useMemo(
    () =>
      profileSpan("overlay", () => {
        const withSelection = overlaySelection(visibleRows, selection, firstRow, cols)
        // While a selection is active, the synthetic cursor cell is hidden
        // (tmux copy-mode behavior): cursor and selection share the same
        // inverse styling, so a cursor sitting just past the selection read
        // as the highlight overrunning by one blinking cell.
        return overlayCursor(withSelection, focused && !selection ? cursor : null, colors)
      }),
    [visibleRows, selection, firstRow, cols, cursor, focused, colors],
  )

  const [grid, setGrid] = useState<BoxRenderable | null>(null)
  const painter = useMemo(() => (grid ? new TerminalRowPainter(grid, renderer) : null), [grid, renderer])
  useLayoutEffect(() => () => painter?.dispose(), [painter])
  useLayoutEffect(() => {
    painter?.paint(cursorRows, cols, colors)
  }, [painter, cursorRows, cols, colors])
  return setGrid
}
