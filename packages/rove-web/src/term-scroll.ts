/**
 * Wheel and follow decisions for the xterm pane, kept pure so they can be tested.
 *
 * The TUI's terminal pane is the reference (`tui-react/panes/terminal`): a wheel
 * goes to the app on the alternate screen; on the normal screen it moves the
 * local scrollback (whole rows to xterm, the fraction of a row as a screen offset,
 * `term-smooth.ts`), unless Shift hands it to an app that tracks
 * the mouse (an inline app cannot scroll the scrollback itself); the view follows new
 * output only while it sits at the bottom, and when the app wipes the
 * scrollback (`ESC[3J`, `ESC c`) under a scrolled view it keeps the same
 * distance from the bottom (`resolveViewportScrollOffset`'s fallback).
 */

/** Who a wheel tick belongs to, in emulator order (TUI `encodeWheel`). */
export function wheelOwner(modes: {
  readonly alternateScreen: boolean
  readonly mouseTracking: boolean
  readonly shift: boolean
}): "app" | "local" {
  return modes.alternateScreen || (modes.mouseTracking && modes.shift) ? "app" : "local"
}

export interface WheelInput {
  readonly deltaY: number
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number
  /** Chromium/Safari's legacy `wheelDeltaY`: a notch of a mouse wheel is 120 there. */
  readonly wheelDeltaY?: number
}

/** A wheel event in lines (negative = up, toward older output). */
export function wheelDelta(event: WheelInput, cellHeight: number, rows: number): number {
  const unit = event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? Math.max(1, rows) : 1 / Math.max(1, cellHeight)
  return event.deltaY * unit
}

/**
 * Whether an event is one notch of a mouse wheel, which arrives as a jump of several lines at once and is
 * eased over a few frames. A touchpad (or the OS's momentum) already sends a stream of small deltas and is
 * followed as it comes; Chromium on a Mac reports `wheelDeltaY` at three times the pixels, which is how a
 * touchpad delta that happens to be a multiple of 120 is told apart from a notch (about 1.2 times).
 */
export function isWheelNotch(event: WheelInput): boolean {
  if (event.deltaMode !== 0) return true
  const legacy = Math.abs(event.wheelDeltaY ?? 0)
  return legacy > 0 && legacy % 120 === 0 && Math.abs(event.deltaY) * 2 > legacy
}

/**
 * Whole lines to hand xterm for a move of `delta` lines, and the fraction left over. The fraction is the
 * nearest whole line away, so it stays within half a line either way and the pane shows it as a pixel offset.
 * It carries across a change of direction: the view is where the fingers put it, not where the last whole
 * line was.
 */
export function scrollStep(carry: number, delta: number): { readonly lines: number; readonly carry: number } {
  const total = carry + delta
  const lines = Math.sign(total) * Math.round(Math.abs(total)) || 0
  return { lines, carry: total - lines }
}

/** The offset a view that sits on the first or last line of the buffer may keep: none toward the edge it cannot leave. */
export function edgeCarry(carry: number, buffer: { readonly baseY: number; readonly viewportY: number }): number {
  if (carry > 0 && buffer.viewportY >= buffer.baseY) return 0
  if (carry < 0 && buffer.viewportY <= 0) return 0
  return carry
}

/** Time constant of the notch ease: a three-line notch is within a pixel of rest after about 0.25s. */
const GLIDE_TAU_MS = 55

/** One frame of easing toward `pending` lines: the part to move now (all of it once what is left is a hair). */
export function glideStep(pending: number, dtMs: number): number {
  const part = pending * (1 - Math.exp(-Math.max(0, dtMs) / GLIDE_TAU_MS))
  return Math.abs(pending - part) < 0.02 ? pending : part
}

/** Lines above the live screen the viewport sits (0 = following the bottom). */
export function linesFromBottom(buffer: { readonly baseY: number; readonly viewportY: number }): number {
  return Math.max(0, buffer.baseY - buffer.viewportY)
}

/**
 * Where the viewport belongs after a write was parsed, or null to leave it.
 * `held` is the distance from the bottom the user was at when the app wiped
 * the scrollback (null when nothing was wiped under a scrolled view). Plain
 * output never needs a correction: xterm keeps a scrolled view on its line and
 * a view at the bottom on the bottom.
 */
export function viewportAfterWrite(
  held: number | null,
  buffer: { readonly baseY: number; readonly viewportY: number },
): number | null {
  if (held === null || held <= 0) return null
  const target = Math.max(0, buffer.baseY - held)
  return target === buffer.viewportY ? null : target
}
