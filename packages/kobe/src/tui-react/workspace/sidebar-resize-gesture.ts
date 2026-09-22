/**
 * The rail-resize gesture, split across the two places it has to live.
 *
 * opentui hands pointer capture to whatever the cursor is over on the FIRST
 * motion report, not to whatever was pressed (`processSingleMouseEvent`). A
 * one-cell grip loses that race every time: by the first report the cursor is
 * already cells away, capture goes to the terminal pane, and the grip never
 * hears `drag` or `up` again. Measured, not assumed — a 24-cell pull and a
 * 4-cell nudge both left the rail exactly where it was.
 *
 * Growing the grip on press does not fix it either. That needs a React commit
 * to land between the press and the first motion, which a browser driver's
 * 30ms pause supplies and a real flick of the wrist does not.
 *
 * So the press arms the gesture and an ANCESTOR of every pane finishes it.
 * Wherever capture lands, the event bubbles up through the row that holds the
 * panes, and that row is always above it. Nothing has to be reached, expanded,
 * or timed.
 *
 * Width comes from the drag's OFFSET (`start + Δx`), never the cursor's
 * column, so none of this has to know where the rail's left edge is.
 */

import { useRef, useState } from "react"

/** Two releases closer together than this are one double-click. */
const DOUBLE_CLICK_MS = 400

/** The slice of opentui's MouseEvent this gesture reads. */
export interface GestureMouseEvent {
  readonly x: number
}

export interface SidebarResizeGesture {
  /** A press on the grip is live — the grip keeps its light until release. */
  readonly active: boolean
  /** Goes on the grip: arms a gesture from the rail's current width. */
  readonly onGripDown: (event: GestureMouseEvent) => void
  /** Goes on the pane row: live width while the cursor travels. */
  readonly onPaneDrag: (event: GestureMouseEvent) => void
  /** Goes on the pane row: ends the gesture, or counts a double-click. */
  readonly onPaneRelease: () => void
}

export function useSidebarResizeGesture(opts: {
  /** The rail's width right now — every drag offsets from this. */
  readonly width: number
  readonly onResize: (width: number) => void
  /** Double-click on the grip: back to the terminal-derived width. */
  readonly onReset: () => void
}): SidebarResizeGesture {
  const armed = useRef<{ x: number; width: number; moved: boolean } | null>(null)
  const lastRelease = useRef(0)
  // Mirrors `armed` for paint only. It flips on press and on release — two
  // renders a gesture — while the drag itself stays in the ref, so travel
  // never waits on a commit.
  const [active, setActive] = useState(false)
  return {
    active,
    onGripDown: (event) => {
      armed.current = { x: event.x, width: opts.width, moved: false }
      setActive(true)
    },
    onPaneDrag: (event) => {
      // Every drag in the workspace bubbles through here, including the ones
      // that belong to a text selection — an unarmed gesture must be silent.
      const from = armed.current
      if (from == null) return
      const delta = event.x - from.x
      if (delta === 0) return
      from.moved = true
      opts.onResize(from.width + delta)
    },
    onPaneRelease: () => {
      const from = armed.current
      if (from == null) return
      armed.current = null
      setActive(false)
      // A drag is never half of a double-click: resizing twice in a row must
      // not throw away the width the first drag just set.
      if (from.moved) {
        lastRelease.current = 0
        return
      }
      const now = Date.now()
      if (now - lastRelease.current < DOUBLE_CLICK_MS) {
        lastRelease.current = 0
        opts.onReset()
        return
      }
      lastRelease.current = now
    },
  }
}
