/** Pointer events routed to the app inside the PTY, in emulator order. */

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
   * Emulator order for ANY scroll (wheel, or a selection drag past an edge):
   * an app with mouse tracking or on the alternate screen gets wheel events;
   * otherwise kobe's local viewport moves. Engines on the ALTERNATE screen
   * have no local scrollback, so an edge drag must ask the app. Coords are
   * absolute. True = forwarded; the selection hook then tracks the shift.
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
   * Button transitions: with mouse tracking, send an SGR event to the app and
   * skip the grid selection. Shift bypasses the app (as iTerm/kitty do). A
   * forwarded press owns its release, so a drag can't turn into a local
   * selection halfway.
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
