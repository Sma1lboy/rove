/**
 * Narrow-layout breakpoint (phone SSH, ~46×70 cells). Below it the workspace
 * is single-panel; at or above it the desktop layout must be byte-identical
 * (golden stubs), so every narrow consumer gates on this one predicate.
 */

import { DEFAULT_NARROW_BELOW, normalizeNarrowBelow } from "../state/narrow-layout"

/** The default; the TUI's own breakpoint is `layout.narrowBelow`. Kept fs-free: rove-web imports this module. */
export const NARROW_BREAKPOINT = DEFAULT_NARROW_BELOW

let breakpoint = DEFAULT_NARROW_BELOW

/** Adopt a `layout.narrowBelow` value: host boot reads it from `state.json`, KV hosts keep it live. */
export function setNarrowBreakpoint(value: unknown): void {
  breakpoint = normalizeNarrowBelow(value)
}

/** True when the terminal is too narrow for the three-pane desktop layout. */
export function isNarrowWidth(cols: number): boolean {
  return cols < breakpoint
}

export type NarrowSurface = "sidebar" | "content"

/**
 * Sidebar focus shows the list (ctrl+q is the back gesture). Otherwise
 * content shows when there is a selected task or an open rail page, else
 * the sidebar — the content pane would only say "no task".
 */
export function narrowSurface(args: {
  focusedPane: string
  hasSelection: boolean
  hasOpenPage: boolean
}): NarrowSurface {
  if (args.focusedPane === "sidebar") return "sidebar"
  return args.hasSelection || args.hasOpenPage ? "content" : "sidebar"
}
