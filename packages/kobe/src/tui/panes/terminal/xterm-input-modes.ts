/**
 * What the PTY program asked the terminal to do with pointer and key input,
 * read off xterm's mode state. Encoders return bytes for the caller to write.
 *
 * Every probe is best-effort: a killed or mid-teardown emulator can throw from
 * `term.modes`, and the pane must fall back to Rove's own handling, never
 * take the TUI down.
 */

import type { Terminal as XtermHeadless } from "@xterm/headless"
import { type TerminalInputModes, encodeMouseButton, encodeWheel } from "./keys-pure"

/** Derived from xterm's type, not restated, so a widened `mouseTrackingMode` union can't slip past `keys-pure`. */
export type XtermModeSource = Pick<XtermHeadless, "modes" | "buffer">

/** Cursor-key / keypad modes, as `keys-pure` needs them to encode a keypress. */
export function readInputModes(term: XtermModeSource): TerminalInputModes {
  try {
    return {
      applicationCursorKeys: term.modes.applicationCursorKeysMode === true,
      applicationKeypad: term.modes.applicationKeypadMode === true,
    }
  } catch {
    return { applicationCursorKeys: false, applicationKeypad: false }
  }
}

/** True while the program is tracking the mouse itself (Rove must not). */
export function appOwnsMouse(term: XtermModeSource): boolean {
  try {
    return term.modes.mouseTrackingMode !== "none"
  } catch {
    return false
  }
}

/** True on the alternate screen — a full-screen app, not a scrolling shell. */
export function onAlternateScreen(term: XtermModeSource): boolean {
  try {
    return term.buffer.active.type === "alternate"
  } catch {
    return false
  }
}

/** Bytes for a wheel tick, or null when the program wants none. */
export function wheelSequence(
  term: XtermModeSource,
  direction: "up" | "down",
  col: number,
  row: number,
): string | null {
  try {
    return encodeWheel(
      {
        mouseTracking: term.modes.mouseTrackingMode !== "none",
        applicationCursorKeys: term.modes.applicationCursorKeysMode === true,
        alternateScreen: term.buffer.active.type === "alternate",
      },
      direction,
      col,
      row,
    )
  } catch {
    return null
  }
}

/** Bytes for a mouse button event, or null when the program wants none. */
export function mouseButtonSequence(
  term: XtermModeSource,
  kind: "down" | "up" | "drag",
  button: 0 | 1 | 2,
  col: number,
  row: number,
  modifiers?: { shift?: boolean; alt?: boolean; ctrl?: boolean },
): string | null {
  try {
    return encodeMouseButton({ mouseTracking: term.modes.mouseTrackingMode }, kind, button, col, row, modifiers)
  } catch {
    return null
  }
}
