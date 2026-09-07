/**
 * The terminal pane's paint pipeline: visible snapshot rows + the overlays
 * that sit on them (selection, search hits, cursor) → the ONE `StyledText`
 * the pane's single `<text>` renders.
 *
 * Split out of `Terminal.tsx` because it is a different job from the rest of
 * that file: the component owns the PTY lifecycle, geometry, and layout,
 * while everything here is "given these rows and these overlays, produce the
 * frame". Behavior is unchanged from when it lived inline — same memo
 * boundaries, same imperative push.
 */

import type { TextRenderable } from "@opentui/core"
import { StyledText } from "@opentui/core"
import { useEffect, useMemo, useState } from "react"
import { profileSpan, profileTick } from "../../../tui/lib/render-profile"
import type { TerminalRow } from "../../../tui/panes/terminal/pty"
import { rowsToStyledText } from "../../../tui/panes/terminal/sgr-to-text-chunk"
import {
  type TerminalRenderColors,
  overlayCursor,
  resolveInverseAttributes,
  sealRowEndAttributes,
} from "../../../tui/panes/terminal/terminal-render"
import { type SelectionRange, overlaySelection } from "../../../tui/panes/terminal/terminal-selection"

export interface UseTerminalPaintOpts {
  readonly visibleRows: readonly TerminalRow[]
  /** Absolute snapshot row index of the first visible row. */
  readonly firstRow: number
  readonly cols: number
  readonly selection: SelectionRange | null
  /** Overlay the search hits — {@link useTerminalSearch}'s reference-stable painter. */
  readonly paintMatches: (rows: readonly TerminalRow[], firstRow: number, width: number) => readonly TerminalRow[]
  /** Viewport-relative cursor, or null when there is none to draw. */
  readonly cursor: { x: number; y: number } | null
  readonly focused: boolean
  readonly colors: TerminalRenderColors
}

/** Ref callback for the pane's snapshot `<text>`; the content is pushed into it imperatively. */
export function useTerminalPaint(opts: UseTerminalPaintOpts): (el: TextRenderable | null) => void {
  const { visibleRows, firstRow, cols, selection, paintMatches, cursor, focused, colors } = opts

  const cursorRows = useMemo(
    () =>
      profileSpan("overlay", () => {
        const withSelection = overlaySelection(visibleRows, selection, firstRow, cols)
        // Search hits paint OVER the selection: the two can coexist (a highlight
        // survives until the next click), and the hit is what you are steering.
        const withMatches = paintMatches(withSelection, firstRow, cols)
        // While a selection is active, the synthetic cursor cell is hidden
        // (tmux copy-mode behavior): cursor and selection share the same
        // inverse styling, so a cursor sitting just past the selection read
        // as the highlight overrunning by one blinking cell.
        return overlayCursor(withMatches, focused && !selection ? cursor : null, colors)
      }),
    [visibleRows, selection, firstRow, cols, paintMatches, cursor, focused, colors],
  )

  // Flatten every visible row into ONE `StyledText`. A single element (not
  // per-row `<text>`s) is what makes the cursor positioning math work: the
  // cursor is placed by offset into one text node.
  //
  // `sealRowEndAttributes` is a local workaround for an opentui renderer bug:
  // attributes open at a row's last column leak into the rest of the frame,
  // so a wrapped underlined URL underlines everything below it. Its doc
  // comment has the full mechanism; drop this call once opentui resets per
  // row.
  const styledSnapshot = useMemo(
    () =>
      profileSpan("styled", () => {
        const resolved = resolveInverseAttributes(cursorRows, colors.foreground, colors.background)
        const sealed = sealRowEndAttributes(resolved, cols, colors.foreground, colors.background)
        return new StyledText(rowsToStyledText(sealed))
      }),
    [cursorRows, cols, colors],
  )

  // Imperative content push — opentui 0.4 won't accept StyledText as a
  // JSX child or through the content prop (stringifies it).
  const [snapshotTextEl, setSnapshotTextEl] = useState<TextRenderable | null>(null)
  useEffect(() => {
    // `isDestroyed` guard: when the pane flips pty→null (failed reset) the
    // <text> unmounts, but its null ref lands a render AFTER this effect
    // re-runs with the stale element — writing to it throws "TextBuffer is
    // destroyed" into the error boundary.
    if (snapshotTextEl && !snapshotTextEl.isDestroyed) {
      profileTick("push")
      snapshotTextEl.content = styledSnapshot
    }
  }, [snapshotTextEl, styledSnapshot])

  return setSnapshotTextEl
}
