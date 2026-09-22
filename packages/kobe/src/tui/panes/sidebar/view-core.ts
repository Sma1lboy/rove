/** Pure view derivations for the React sidebar: no React, no opentui. */

import { charWidth, displayWidth } from "../../../lib/display-width"
import { truncateEnd, truncateEndCells } from "../../lib/truncate"
import type { SidebarTone } from "./row-view"

/** Minimum task-list rail width; also the width at and below ~144 cols ({@link sidebarWidthFor}). */
export const SIDEBAR_WIDTH = 24

/**
 * Rail width: a sixth of the terminal, clamped to [SIDEBAR_WIDTH, 40], so
 * branch names get room on wide terminals. 120 → 24, 160 → 26, 200 → 33,
 * 240 → 40; the workspace keeps ~⅔ at every width.
 */
export function sidebarWidthFor(terminalWidth: number): number {
  return Math.max(SIDEBAR_WIDTH, Math.min(40, Math.floor(terminalWidth / 6)))
}

/** Cells the workspace keeps however wide the rail is pinned (the files pane alone claims 22). */
export const MIN_WORKSPACE_WIDTH = 40

/**
 * The rail's width: the user's pin, else {@link sidebarWidthFor} (`null`).
 * Clamped on every read, not at write time, so a pin survives a narrow
 * terminal and returns when it widens again.
 */
export function resolveSidebarWidth(terminalWidth: number, override: number | null): number {
  if (override == null) return sidebarWidthFor(terminalWidth)
  const max = Math.max(SIDEBAR_WIDTH, terminalWidth - MIN_WORKSPACE_WIDTH)
  return Math.max(SIDEBAR_WIDTH, Math.min(max, Math.round(override)))
}

/** Polling interval for the per-main-row git branch refresh. */
export const MAIN_BRANCH_POLL_MS = 2_000

/**
 * Card line-1 budget: marker + badge + leading space + right pad + breathing
 * cell = 5 reserved (the move chip may still shrink the title via flex).
 */
export function titleBudgetFor(width: number): number {
  return Math.max(6, width - 5)
}

/**
 * Card line-2 BASE budget: marker + 2-cell indent + right pad + breathing
 * cell = 5. Cards subtract the LIVE pin/PR/`+N −M` width per row.
 */
export function subtitleBudgetFor(width: number): number {
  return Math.max(6, width - 5)
}

/**
 * Fit the project filter into the PROJECTS header: reserves the section label
 * + 2 padding + 2 gaps + 1 divider cell (Yoga may shrink it to zero). Measured
 * in cells so a wide CJK glyph can't paint past the edge.
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

/** PROJECTS scroll height: a quarter of the terminal clamped to [2, 10], shrunk to content (2 lines per card). */
export function projectScrollMaxHeightFor(terminalHeight: number, projectRowCount: number): number {
  const cellCap = Math.max(2, Math.min(10, Math.floor(terminalHeight * 0.25)))
  const contentHeight = Math.max(2, projectRowCount * 2)
  return Math.min(cellCap, contentHeight)
}

/** i18n key for the task list's empty placeholder; `searching` wins, then project scope. */
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

/**
 * A plugin's semantic tone (`row-tokens.ts`) mapped onto the rail's tones:
 * plugins name a role, never a colour, so they can't clash with the user's
 * theme. `info` → `primary` so a plugin label reads like the row, not louder.
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

/** Map a row tone to its theme slot. */
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
 * `/`-search input reducer: the next query, or null when the key isn't the
 * input's (consumed, modifier-prefixed, or non-printable; search-mode bindings
 * handle those). Backspace pops a char.
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
