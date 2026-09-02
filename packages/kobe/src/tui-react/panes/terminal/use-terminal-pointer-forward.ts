/**
 * Pointer events routed to the app inside the PTY, in emulator order — the
 * half of the terminal pane's mouse wiring that talks to the PTY rather than
 * to the local grid selection.
 */

import { useRef } from "react"
import type { TaskPtyLike } from "../../../tui/panes/terminal/pty-types"

type PointerEvent = {
  button: number
  x: number
  y: number
  modifiers?: { shift: boolean; alt: boolean; ctrl: boolean }
}

export function useTerminalPointerForward(opts: {
  pty: TaskPtyLike | null
  bodyEl: { screenX: number; screenY: number } | null
  /** Move kobe's local viewport; positive is toward newer output. */
  scrollBy: (lines: number) => void
}) {
  const { pty, bodyEl, scrollBy } = opts
  // True between a press the app accepted and its release.
  const mouseOwnedByApp = useRef(false)

  const paneCell = (screenX: number, screenY: number, body: { screenX: number; screenY: number }) => ({
    col: Math.max(1, screenX - body.screenX + 1),
    row: Math.max(1, screenY - body.screenY + 1),
  })

  /**
   * Emulator order for ANY scroll this pane performs — a wheel tick or a
   * selection drag hanging past an edge. An app that owns its own scrollback
   * (mouse tracking, or a fullscreen app on the alternate screen) gets wheel
   * events; only when it wants neither do we move kobe's local viewport.
   * Engine tabs are why this matters for the drag: Claude Code runs on the
   * ALTERNATE screen, where there is no local scrollback to move at all, so a
   * drag held at the edge has to ask the app to scroll, exactly as the wheel
   * does. `screenX`/`screenY` are absolute pointer coords. Returns true when
   * the scroll was forwarded — the selection hook then tracks the content
   * shifts the app's redraws cause under the fixed snapshot rows.
   */
  const scrollFromPointer = (lines: number, screenX: number, screenY: number): boolean => {
    if (lines === 0) return false
    const direction = lines < 0 ? "up" : "down"
    if (pty && !pty.killed && bodyEl) {
      const { col, row } = paneCell(screenX, screenY, bodyEl)
      if (pty.wheel(direction, col, row)) {
        for (let i = 1; i < Math.abs(lines); i++) pty.wheel(direction, col, row)
        return true
      }
    }
    scrollBy(lines)
    return false
  }

  /**
   * Same order for a button transition: the app enabled mouse tracking → encode
   * an SGR event and hand the click to the app (Claude Code's expandable tool
   * rows, vim, less…), and the pane's grid selection never sees it. Shift
   * bypasses the app the way iTerm/kitty do, so text can still be selected
   * out of a mouse-aware app. A press that was forwarded owns its release
   * too — a drag that leaves the grid must not fall through into a local
   * selection halfway through.
   */
  const forwardMouse = (kind: "down" | "up" | "drag", evt: PointerEvent): boolean => {
    if (kind === "down") mouseOwnedByApp.current = false
    if (!pty || pty.killed || !bodyEl) return false
    if (kind !== "down" && !mouseOwnedByApp.current) return false
    if (evt.modifiers?.shift) return false
    if (evt.button !== 0 && evt.button !== 1 && evt.button !== 2) return kind !== "down" && mouseOwnedByApp.current
    const { col, row } = paneCell(evt.x, evt.y, bodyEl)
    const forwarded = pty.click(kind, evt.button, col, row, evt.modifiers)
    if (kind === "down") mouseOwnedByApp.current = forwarded
    // A drag the app declined (x10/vt200 tracking) is still its gesture.
    return forwarded || mouseOwnedByApp.current
  }

  return { scrollFromPointer, forwardMouse }
}
