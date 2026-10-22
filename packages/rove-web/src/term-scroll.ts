/**
 * Wheel and follow decisions for the xterm pane, kept pure so they can be tested.
 *
 * The TUI's terminal pane is the reference (`tui-react/panes/terminal`): a wheel
 * goes to the app when it tracks the mouse or owns the alternate screen,
 * otherwise it moves the local scrollback by whole lines; the view follows new
 * output only while it sits at the bottom, and when the app wipes the
 * scrollback (`ESC[3J`, `ESC c`) under a scrolled view it keeps the same
 * distance from the bottom (`resolveViewportScrollOffset`'s fallback).
 */

/** Who a wheel tick belongs to, in emulator order. */
export function wheelOwner(modes: { readonly alternateScreen: boolean; readonly mouseTracking: boolean }):
  | "app"
  | "local" {
  return modes.mouseTracking || modes.alternateScreen ? "app" : "local"
}

export interface WheelInput {
  readonly deltaY: number
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number
}

/**
 * Whole lines to scroll for one wheel event (negative = up, toward older
 * output) plus the fraction carried to the next event. A touchpad sends many
 * sub-line deltas; they add up here instead of being dropped, and a change of
 * direction starts from zero.
 */
export function wheelLines(
  carry: number,
  event: WheelInput,
  cellHeight: number,
  rows: number,
): { readonly lines: number; readonly carry: number } {
  const unit = event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? Math.max(1, rows) : 1 / Math.max(1, cellHeight)
  const delta = event.deltaY * unit
  const start = Math.sign(carry) !== 0 && Math.sign(carry) !== Math.sign(delta) ? 0 : carry
  const total = start + delta
  const lines = Math.trunc(total) || 0
  return { lines, carry: total - lines }
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
