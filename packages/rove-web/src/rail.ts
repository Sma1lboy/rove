/**
 * The Tasks rail's shape: project → task → tab, in the daemon's manual order
 * (the TUI's default sort), with the TUI's status glyph vocabulary
 * (`tui/panes/sidebar/row-view.ts`, braille preset).
 */

import type { TaskRow } from "rove-bridge/protocol"

export interface ProjectGroup {
  readonly repo: string
  readonly label: string
  readonly tasks: readonly TaskRow[]
}

export function groupByProject(tasks: readonly TaskRow[]): ProjectGroup[] {
  const ordered = [...tasks].sort((a, b) => (a.order ?? a.rank) - (b.order ?? b.rank))
  const groups = new Map<string, TaskRow[]>()
  for (const task of ordered) {
    const list = groups.get(task.repo)
    if (list) list.push(task)
    else groups.set(task.repo, [task])
  }
  return [...groups].map(([repo, rows]) => ({
    repo,
    label: repo.split("/").filter(Boolean).pop() ?? repo,
    tasks: rows,
  }))
}

export type Tone = "accent" | "muted" | "attention" | "warning" | "ink"

/** `engine/spinner-frames.ts` DEFAULT_SPINNER_FRAMES. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function activityGlyph(state: string | undefined, frame: number): { glyph: string; tone: Tone } {
  switch (state) {
    case "running":
      return { glyph: SPINNER[frame % SPINNER.length], tone: "accent" }
    case "permission_needed":
      return { glyph: "?", tone: "warning" }
    case "rate_limited":
    case "error":
    case "dead":
      return { glyph: "!", tone: "attention" }
    case "turn_complete":
      return { glyph: "●", tone: "accent" }
    default:
      return { glyph: "○", tone: "muted" }
  }
}
