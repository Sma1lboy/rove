/**
 * Windows a flat list of ONE-CELL rows down to the scrollbox viewport plus a
 * small overscan.
 *
 * Its own file rather than more of `FileTree.tsx` because it is a different
 * job from the tree: everything here reads the scrollbox's imperative layout
 * state and turns it into a row range, and nothing here knows what a row is.
 *
 * Why it exists at all: opentui lays out every renderable under the scrollbox
 * on every frame, whether or not the viewport can show it. `viewportCulling`
 * (on by default) only skips the PAINT of off-screen children, and only for
 * DIRECT children of the scrollbox content — a wrapper box holding the rows
 * hides them from it entirely. Memoizing the rows removes the React half and
 * leaves the layout: measured on this pane against one 5000-file directory,
 * a `j` keystroke cost 24ms of wall time, 19.6ms of it opentui frame time,
 * with every row mounted.
 *
 * The two spacer boxes the caller pads with keep the content's total height
 * equal to `rowCount`, so the scrollbar thumb, `scrollTop`, and the pane's own
 * cursor-follow arithmetic all still see the whole list.
 *
 * ROW HEIGHT IS ASSUMED TO BE 1. That holds for every FileTree row (each is a
 * single `flexDirection="row"` box of `wrapMode="none"` text). A list with
 * taller or variable rows cannot use this hook — the sidebar tree, whose
 * project headers carry a pad row, is exactly that case.
 *
 * Measurement rides the renderer's frame event rather than a callback on the
 * scrollbox, because the two events that would announce a change are both
 * unavailable: the scrollbox installs its own `onSizeChange` on the viewport
 * (passing one through `viewportOptions` REPLACES the bar recalculation), and
 * the scrollbar's own change event fires only once a position actually moves,
 * never for the first layout. Reading two numbers per drawn frame is cheaper
 * than either workaround, and it means a scroll from any source — wheel, drag,
 * keys, `scrollTo` — lands the same way. State is only set when a number
 * really changed, so an idle pane re-renders nothing.
 */

import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useCallback, useEffect, useState } from "react"

/** Rows kept above and below the viewport so a one-line scroll never shows a gap. */
const OVERSCAN = 16

/** Rows rendered before the first layout has given the viewport a height. */
const PRE_LAYOUT_ROWS = 64

export interface RowWindow {
  /** First row index to render. */
  readonly start: number
  /** One past the last row index to render. */
  readonly end: number
  /**
   * Re-read the scroll position now. The caller MUST call this straight after
   * moving the scroll itself: a jump of more than one viewport leaves the old
   * window entirely off screen, and waiting for the next drawn frame to notice
   * shows a blank pane — or leaves it blank for good, when that scroll was the
   * last thing asking for a redraw.
   */
  readonly sample: () => void
}

export function useRowWindow(opts: {
  /** The scrollbox element, as state — the hook re-reads when it changes. */
  readonly scrollEl: ScrollBoxRenderable | null
  readonly rowCount: number
}): RowWindow {
  const { scrollEl, rowCount } = opts
  const renderer = useRenderer()
  const [view, setView] = useState<{ top: number; height: number }>({ top: 0, height: 0 })

  const sample = useCallback((): void => {
    if (!scrollEl || scrollEl.isDestroyed) return
    const top = scrollEl.scrollTop
    const height = scrollEl.viewport.height
    // Set-on-change only: this runs once per drawn frame and once per render of
    // the owning pane, and an unconditional update from either would loop.
    setView((cur) => (cur.top === top && cur.height === height ? cur : { top, height }))
  }, [scrollEl])

  useEffect(() => {
    if (!renderer) return
    sample()
    renderer.on("frame", sample)
    return () => {
      renderer.off("frame", sample)
    }
  }, [renderer, sample])

  if (rowCount === 0) return { start: 0, end: 0, sample }
  if (view.height <= 0) return { start: 0, end: Math.min(rowCount, PRE_LAYOUT_ROWS), sample }
  const start = Math.max(0, Math.floor(view.top) - OVERSCAN)
  const end = Math.min(rowCount, Math.ceil(view.top + view.height) + OVERSCAN)
  return { start, end: Math.max(start, end), sample }
}
