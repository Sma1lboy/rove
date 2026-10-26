/** Status marks a rail row draws: the glyph set, the tone palette, and the rollups over a folded group. */

import { type RowTone, rowStatusGlyph } from "@sma1lboy/rove/src/lib/row-status-glyph.ts"
import type { RowStatus, TaskRow } from "rove-bridge/protocol"
import type { GlyphSet } from "./prefs.ts"

export type Tone = "accent" | "muted" | "attention" | "warning" | "success" | "ink"

/** The state marks a row draws, from the chosen glyph set (`tui/lib/glyphs.ts`); braille until the bridge answers. */
export type RowGlyphs = Pick<GlyphSet, "spinner" | "idle" | "unseen" | "needsInput" | "attention">

/** `engine/spinner-frames.ts` DEFAULT_SPINNER_FRAMES with the braille preset's marks. */
export const BRAILLE: RowGlyphs = {
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  idle: "○",
  unseen: "●",
  needsInput: "?",
  attention: "!",
}

/** The web palette for a status tone: a wait you can clear is amber, what stays broken is red. */
const TONE: Readonly<Record<RowTone, Tone>> = {
  accent: "accent",
  warning: "warning",
  error: "attention",
  muted: "muted",
}

/** Nerd Font icons the rail draws (the font ships with the page, `styles.css`). */
export const NERD = {
  /** nf-oct-git_branch: a child in its own worktree. */
  branch: "\u{f418}",
  /** nf-oct-file_directory: a child sharing its parent's directory. */
  shared: "\u{f413}",
  /** nf-oct-chevron_down / nf-oct-chevron_right: a parent's fold. */
  unfolded: "\u{f47c}",
  folded: "\u{f460}",
} as const

export interface StatusMark {
  readonly glyph: string
  readonly tone: Tone
  readonly spinning: boolean
}

/** A daemon status as a rail draws it; no status (no reading yet) is a quiet row. */
export function statusGlyph(status: RowStatus | undefined, frame: number, glyphs: RowGlyphs = BRAILLE): StatusMark {
  const mark = rowStatusGlyph(status, glyphs, frame)
  return { glyph: mark.glyph, tone: TONE[mark.tone], spinning: mark.spinning }
}

/** A task row's mark: the daemon's rollup of its one conversation. */
export function taskRowGlyph(task: TaskRow, frame: number, glyphs: RowGlyphs = BRAILLE): StatusMark {
  return statusGlyph(task.rowStatus, frame, glyphs)
}

/** Some row on screen spins: the shared spinner clock must tick. */
export function anySpinning(tasks: readonly TaskRow[]): boolean {
  return tasks.some((task) => task.rowStatus?.kind === "running" || task.rowStatus?.kind === "busy")
}

/** A folded group's rows that need a person: something to answer or something broken. */
export function needsPerson(task: TaskRow): boolean {
  return task.rowStatus?.kind === "needs-input" || task.rowStatus?.kind === "attention"
}

// `rove-daemon/daemon/row-status.ts` RANK (not importable here): what a task row ranks its tabs by.
const URGENCY: Readonly<Record<RowStatus["kind"], number>> = {
  busy: 0,
  attention: 1,
  "needs-input": 2,
  running: 3,
  unseen: 4,
  idle: 5,
}

/** The most urgent rollup among `tasks` (a folded parent's hidden children), or undefined when none has a status yet. */
export function mostUrgentStatus(tasks: readonly TaskRow[]): RowStatus | undefined {
  let best: RowStatus | undefined
  for (const { rowStatus: status } of tasks) {
    if (!status) continue
    if (!best || URGENCY[status.kind] < URGENCY[best.kind]) best = status
    else if (status.kind === best.kind && status.since > best.since) best = status
  }
  return best
}
