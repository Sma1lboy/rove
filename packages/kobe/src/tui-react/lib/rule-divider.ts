/**
 * The `LABEL ─── suffix` rule for section headers. Repeated to the TERMINAL
 * width: the rule sits in a shrinking flex slot, and any fixed count is a
 * ceiling past which the suffix floats in a gap (240-col dual-monitor tmux).
 * No row is wider than the terminal, so this always suffices. Min one cell.
 */
export function dividerRule(terminalWidth: number): string {
  return "─".repeat(Math.max(1, terminalWidth))
}
