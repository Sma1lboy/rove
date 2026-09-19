/**
 * Framework-free view logic for the React sidebar. Pure derivations only — no React, no
 * opentui: view-tab cycling, line budgets, the search-input keystroke
 * reducer, empty-state / label i18n-key selection, and small row helpers
 * (theme-core / lookup / message-core precedent).
 */

import { charWidth, displayWidth } from "../../../lib/display-width"
import { truncateEnd, truncateEndCells } from "../../lib/truncate"
import type { SidebarTone } from "./row-view"

/** Minimum width of the PureTUI task-list rail. Also the width
 * at and below ~144 cols, see {@link sidebarWidthFor}. */
export const SIDEBAR_WIDTH = 24

/**
 * Wide-terminal rail width: a sixth of the terminal, clamped to
 * [SIDEBAR_WIDTH, 40]. A fixed 24 rail never grew, so branch names
 * truncated on 200-col terminals with the middle pane idle; the Files pane
 * already scales by the same principle (a third of what's left). Growth
 * onset is ~150 cols: 120 → 24, 160 → 26, 200 → 33, 240 → 40 — the
 * workspace keeps ~⅔ of the terminal at every width.
 */
export function sidebarWidthFor(terminalWidth: number): number {
  return Math.max(SIDEBAR_WIDTH, Math.min(40, Math.floor(terminalWidth / 6)))
}

/**
 * Cells the workspace keeps no matter how wide the rail is pinned. The files
 * pane alone claims 22, and a terminal narrower than a short command line is
 * not a terminal — so a pin that would starve the right half is clamped here
 * rather than honoured.
 */
export const MIN_WORKSPACE_WIDTH = 40

/**
 * The rail's width: the user's pin when there is one, the derived width
 * otherwise. `null` means "follow the terminal" — the pin is an OVERRIDE, not
 * a replacement, so clearing it returns to {@link sidebarWidthFor}.
 *
 * The clamp runs on every read rather than at write time, which is what makes
 * a pin survive a narrow terminal: shrinking the window squeezes the rail down
 * to what fits, widening it again pays the pinned width back. Storing the
 * clamped value instead would lose the pin the first time someone split their
 * screen.
 */
export function resolveSidebarWidth(terminalWidth: number, override: number | null): number {
  if (override == null) return sidebarWidthFor(terminalWidth)
  const max = Math.max(SIDEBAR_WIDTH, terminalWidth - MIN_WORKSPACE_WIDTH)
  return Math.max(SIDEBAR_WIDTH, Math.min(max, Math.round(override)))
}

/** Polling interval for the per-main-row git branch refresh. */
export const MAIN_BRANCH_POLL_MS = 2_000

/**
 * Two-line card budgets. Line 1: selection marker (1) + badge (1) +
 * spacedTitle's leading space (1) + right pad (1) + one breathing cell =
 * 5 reserved (the move chip may still shrink the title via flex).
 */
export function titleBudgetFor(width: number): number {
  return Math.max(6, width - 5)
}

/**
 * Line 2 BASE budget: marker (1) + badge-column indent (2) + right pad (1)
 * + one breathing cell = 5 reserved — same as the title line. No static
 * cluster reserve: the cards subtract the LIVE pin/PR/`+N −M` width per
 * row, so a branch on a quiet row runs the full rail width.
 */
export function subtitleBudgetFor(width: number): number {
  return Math.max(6, width - 5)
}

/**
 * Fit the active project filter into the PROJECTS header. Besides the
 * translated section label, the row reserves two padding cells and two gaps,
 * plus one safety cell for the divider (which Yoga may shrink to zero). The
 * label itself is measured in terminal cells so a wide CJK glyph cannot paint
 * past the sidebar edge.
 */
export function truncateProjectFilterLabel(opts: {
  readonly label: string
  readonly sectionLabel: string
  readonly width: number
}): string {
  const { label, sectionLabel, width } = opts
  const reservedCells = displayWidth(sectionLabel) + 5
  return truncateEndCells(label, Math.max(0, width - reservedCells), charWidth)
}

/**
 * PROJECTS scroll-region height: cap derived from terminal cells, clamped
 * to a small rail band, then shrunk to the actual content (each project
 * card is 2 lines) so a one-project workspace doesn't reserve dead space.
 */
export function projectScrollMaxHeightFor(terminalHeight: number, projectRowCount: number): number {
  const cellCap = Math.max(2, Math.min(10, Math.floor(terminalHeight * 0.25)))
  const contentHeight = Math.max(2, projectRowCount * 2)
  return Math.min(cellCap, contentHeight)
}

/**
 * i18n key for the task list's empty-state / scoped-empty placeholder.
 * `searching` wins (no fuzzy match), then a project-scoped empty, then the
 * plain empty copy.
 */
export function sidebarEmptyStateKey(opts: { readonly searching: boolean; readonly projectFilter: boolean }): string {
  if (opts.searching) return "tasks.empty.noMatchSearch"
  if (opts.projectFilter) return "tasks.empty.noActiveProject"
  return "tasks.empty.noActive"
}

/** Widest branch label a two-line card renders before tail-truncation. */
export const BRANCH_LABEL_MAX = 16

export function truncateBranchLabel(branch: string, max = BRANCH_LABEL_MAX): string {
  return truncateEnd(branch, max)
}

/** Map a row tone to its theme slot. */
/**
 * A PLUGIN's semantic tone (`row-tokens.ts`) mapped onto the rail's own tone
 * vocabulary — the boundary that keeps the theme in charge. A plugin names a
 * role, never a colour, so the one thing it can never do is clash with the
 * palette the user chose. `info` lands on `primary` (the rail's neutral
 * emphasis) rather than on an accent of its own: a plugin's ordinary label
 * should read like the row, not louder than it.
 */
export function rowTokenTone(tone: "info" | "success" | "warning" | "error" | "muted"): SidebarTone {
  switch (tone) {
    case "info":
      return "primary"
    case "success":
      return "success"
    case "warning":
      return "warning"
    case "error":
      return "error"
    default:
      return "textMuted"
  }
}

export function toneColor<V>(theme: Record<SidebarTone, V>, tone: SidebarTone): V {
  switch (tone) {
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "primary":
      return theme.primary
    case "error":
      return theme.error
    default:
      return theme.textMuted
  }
}

/** The subset of a keypress the search-input reducer reads. */
export type SearchKeystroke = {
  readonly defaultPrevented: boolean
  readonly ctrl?: boolean
  readonly meta?: boolean
  readonly option?: boolean
  readonly name?: string
  readonly sequence?: string
}

/**
 * `/`-search inline-input reducer: the next query for a keypress, or null
 * when the key doesn't belong to the input (already consumed by a chord,
 * modifier-prefixed, or non-printable — esc/arrows/function keys have
 * multi-byte sequences or names the search-mode bindings already handle).
 * Backspace pops the last char.
 */
export function searchQueryKeystroke(query: string, evt: SearchKeystroke): string | null {
  if (evt.defaultPrevented) return null
  if (evt.ctrl || evt.meta || evt.option) return null
  if (evt.name === "backspace") return query.slice(0, -1)
  const seq = evt.sequence
  if (!seq || seq.length !== 1) return null
  const code = seq.charCodeAt(0)
  if (code < 32 || code === 127) return null
  return query + seq
}
