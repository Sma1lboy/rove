/**
 * Split-pane appearance preference (Settings → General → Appearance).
 *
 * `box` (default) draws a full frame around every split leaf — the pane
 * reads as a card, matching the workspace's bordered columns. `line` is
 * the tmux-style minimal look: each leaf draws only the single edge it
 * shares with its previous sibling. `rail` marks each leaf with one left
 * accent bar; `rule` gives each leaf a top rule with its name riding the
 * right end.
 *
 * kv-persisted; read live by `tui-react/workspace/TerminalSplit.tsx`.
 */

export const SPLIT_STYLE_KEY = "appearance.splitStyle"

export const SPLIT_STYLES = ["box", "line", "rail", "rule"] as const
export type SplitStyle = (typeof SPLIT_STYLES)[number]

const DEFAULT_SPLIT_STYLE: SplitStyle = "box"

/** Coerce a persisted value to a valid style (unknown → default). */
export function normalizeSplitStyle(value: unknown): SplitStyle {
  return SPLIT_STYLES.includes(value as SplitStyle) ? (value as SplitStyle) : DEFAULT_SPLIT_STYLE
}
