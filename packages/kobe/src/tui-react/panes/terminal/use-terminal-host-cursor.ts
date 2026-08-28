/**
 * Host-side terminal output effects: push geometry changes to the PTY and
 * anchor the native host cursor to the visible terminal cell for macOS IME.
 *
 * Split out of `Terminal.tsx` to keep the component under the file-size cap.
 * The caller still supplies the computed viewport cursor (`visibleImeCursor`);
 * this hook only owns the imperative renderer/PTY side-effects and the
 * retention objects that survive across output frames.
 */

import type { BoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import { imeAnchorController } from "../../../tui/lib/ime-anchor-output"
import type { ImeScreenAnchor } from "../../../tui/panes/terminal/ime-cursor"
import { ImeScreenAnchorRetention } from "../../../tui/panes/terminal/ime-cursor"
import type { CursorPos, TaskPty } from "../../../tui/panes/terminal/pty"

export interface UseTerminalHostCursorOpts {
  /** Active PTY handle, null while none is acquired. */
  pty: TaskPty | null
  /** Body box element — provides screen-cell origin for the anchor. */
  bodyEl: BoxRenderable | null
  /** Latest measured geometry — pushed to the PTY on change. */
  bodyGeometry: { cols: number; rows: number } | null
  /** Cursor coordinate within the visible viewport; null hides the anchor. */
  visibleImeCursor: CursorPos | null
  /** Whether this terminal owns the shared host cursor anchor. */
  imeAnchorActive: boolean
  /** Host-terminal dims — invalidation key for non-reactive screen geometry. */
  dims: { width: number; height: number }
  /** Layout tick from the body box's onSizeChange — ditto. */
  geomTick: number
}

export function useTerminalHostCursor(opts: UseTerminalHostCursorOpts): void {
  const { pty, bodyEl, bodyGeometry, visibleImeCursor, imeAnchorActive, dims, geomTick } = opts
  const renderer = useRenderer()
  const imeAnchorOwner = useRef(Symbol("terminal-ime-anchor")).current
  const [imeScreenAnchorRetention] = useState(() => new ImeScreenAnchorRetention())

  // Push geometry changes to the backend, deduped against the last push —
  // real PTY backends may emit SIGWINCH even when geometry is unchanged.
  const lastResizeRef = useRef<{ pty: typeof pty; cols: number; rows: number } | null>(null)
  useEffect(() => {
    if (!pty || !bodyGeometry) return
    const { cols, rows } = bodyGeometry
    const last = lastResizeRef.current
    if (last?.pty === pty && last.cols === cols && last.rows === rows) return
    lastResizeRef.current = { pty, cols, rows }
    try {
      pty.resize(cols, rows)
    } catch {
      /* best effort */
    }
  }, [pty, bodyGeometry])

  // Keep the native host cursor INVISIBLE (the visible cursor is the inline
  // inverse cell in the rendered rows) but ANCHORED to the visible chat
  // terminal's screen cell — even while Sidebar or Files owns keyboard focus.
  // A transient PTY cursor-hide retains the last position; the renderer-output
  // adapter restores it at the end of every diff frame.
  useEffect(() => {
    // Dependency-only invalidation keys — screenX/screenY are read
    // imperatively, non-reactive geometry.
    void dims
    void geomTick
    if (!renderer) return
    if (!imeAnchorActive) {
      imeScreenAnchorRetention.update(null, null)
      if (imeAnchorController.release(imeAnchorOwner)) renderer.setCursorPosition(0, 0, false)
      return
    }
    let currentScreenAnchor: ImeScreenAnchor | null = null
    if (bodyEl && visibleImeCursor && bodyEl.width > 0) {
      currentScreenAnchor = {
        x: bodyEl.screenX + visibleImeCursor.x,
        y: bodyEl.screenY + visibleImeCursor.y,
      }
    }
    // Historical scrollback has no live viewport cursor. Keep the prior
    // screen-cell anchor for this PTY instead of sending the IME to the outer
    // origin. A replacement PTY starts at origin until it reports a cursor.
    const retainedAnchor = imeScreenAnchorRetention.update(pty, currentScreenAnchor)
    if (retainedAnchor) {
      imeAnchorController.claim(imeAnchorOwner, retainedAnchor)
      renderer.setCursorPosition(retainedAnchor.x, retainedAnchor.y, false)
      return
    }
    imeAnchorController.claim(imeAnchorOwner, { x: 0, y: 0 })
    renderer.setCursorPosition(0, 0, false)
  }, [
    renderer,
    imeAnchorActive,
    bodyEl,
    visibleImeCursor,
    dims,
    geomTick,
    imeAnchorOwner,
    imeScreenAnchorRetention,
    pty,
  ])

  // On unmount, hide the cursor so it doesn't leak into whichever pane
  // gains focus next.
  useEffect(() => {
    return () => {
      try {
        if (imeAnchorController.release(imeAnchorOwner)) renderer?.setCursorPosition(0, 0, false)
      } catch {
        /* renderer may already be torn down */
      }
    }
  }, [renderer, imeAnchorOwner])
}
