/**
 * Section-header rule fill — the `LABEL ─── suffix` underline shared by the
 * sidebar chrome and the full-window pages.
 *
 * The rule text sits in a `flexGrow={1} flexShrink={1}` slot, so a fixed
 * repeat count is a silent width ceiling: past it the rule runs dry and the
 * suffix floats in a gap (240 cols breaks on a dual-monitor tmux). Repeating
 * to the TERMINAL width instead means the flex slot always has material to
 * distribute — no row can be wider than the terminal, and the shrunk text
 * clips cleanly mid-glyph-run.
 */

/**
 * Box-drawing rule repeated to `terminalWidth` cells. Callers pass
 * `useTerminalDimensions().width`; a non-positive width yields a minimal
 * one-cell rule so the slot never renders an empty string.
 */
export function dividerRule(terminalWidth: number): string {
  return "─".repeat(Math.max(1, terminalWidth))
}
