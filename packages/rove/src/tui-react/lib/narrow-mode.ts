/**
 * Narrow-layout breakpoint (phone SSH, ~46×70 cells). Below it the workspace
 * is single-panel; at or above it the desktop layout must be byte-identical
 * (golden stubs), so every narrow consumer gates on this one predicate.
 */
export const NARROW_BREAKPOINT = 70

/** True when the terminal is too narrow for the three-pane desktop layout. */
export function isNarrowWidth(cols: number): boolean {
  return cols < NARROW_BREAKPOINT
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
