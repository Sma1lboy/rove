/**
 * The rail-resize gesture, split across two places. opentui gives pointer
 * capture to whatever is under the cursor on the FIRST motion report
 * (`processSingleMouseEvent`), so a one-cell grip always loses it to the
 * terminal pane: measured, a 24-cell pull and a 4-cell nudge both left the rail
 * unmoved. Growing the grip on press needs a React commit before the first
 * motion, which a real flick doesn't allow. So the grip arms the gesture and an
 * ANCESTOR of every pane (the pane row) finishes it via bubbling. Width is
 * `start + Δx`, never the cursor column, so the rail's edge needn't be known.
 */

import { useRef } from "react"

/** Two releases closer together than this are one double-click. */
const DOUBLE_CLICK_MS = 400

export interface GestureMouseEvent {
  readonly x: number
}

export interface SidebarResizeGesture {
  /** Goes on the grip: arms a gesture from the rail's current width. */
  readonly onGripDown: (event: GestureMouseEvent) => void
  /** Goes on the pane row: live width while the cursor travels. */
  readonly onPaneDrag: (event: GestureMouseEvent) => void
  /** Goes on the pane row: ends the gesture, or counts a double-click. */
  readonly onPaneRelease: () => void
}

export function useSidebarResizeGesture(opts: {
  /** Every drag offsets from this. */
  readonly width: number
  readonly onResize: (width: number) => void
  /** Double-click on the grip: back to the terminal-derived width. */
  readonly onReset: () => void
}): SidebarResizeGesture {
  const armed = useRef<{ x: number; width: number; moved: boolean } | null>(null)
  const lastRelease = useRef(0)
  return {
    onGripDown: (event) => {
      armed.current = { x: event.x, width: opts.width, moved: false }
    },
    onPaneDrag: (event) => {
      // Every workspace drag bubbles here (text selections too); unarmed = silent.
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
      // A drag is never half of a double-click, or a second resize would reset the first.
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
