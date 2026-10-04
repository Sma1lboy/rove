/**
 * Windows a flat list of ONE-CELL rows to the scrollbox viewport plus overscan.
 *
 * opentui lays out every renderable under a scrollbox each frame;
 * `viewportCulling` only skips PAINT, and only for direct children (a wrapper
 * box hides rows from it). Measured on one 5000-file directory with every row
 * mounted: a `j` keystroke cost 24ms wall, 19.6ms of it opentui frame time.
 * The caller's two spacer boxes keep total height = `rowCount`, so the thumb,
 * `scrollTop` and cursor-follow math still see the whole list.
 *
 * ROW HEIGHT IS ASSUMED TO BE 1 (true for FileTree rows). Taller/variable rows
 * can't use this — e.g. the sidebar tree, whose project headers carry a pad row.
 *
 * Sampled on the renderer's frame event because neither scrollbox event works:
 * passing `onSizeChange` via `viewportOptions` REPLACES the scrollbox's own bar
 * recalculation, and the scrollbar's change event skips the first layout.
 * Catches every scroll source; state updates only on real change.
 */

import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useCallback, useEffect, useState } from "react"
import { rowWindowRange } from "./row-window-range"

export interface RowWindow {
  /** First row index to render. */
  readonly start: number
  /** One past the last row index to render. */
  readonly end: number
  /**
   * Re-read the scroll position. Call straight after scrolling yourself: a
   * jump of more than one viewport leaves the old window off screen, and
   * waiting for the next frame shows a blank pane — for good, if that scroll
   * was the last thing asking for a redraw.
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
    // Set-on-change only: runs every frame and every owner render; an
    // unconditional update would loop.
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

  const { start, end } = rowWindowRange(view.top, view.height, rowCount)
  return { start, end, sample }
}
