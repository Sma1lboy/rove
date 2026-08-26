/**
 * Shared board renderer used by both the live pane and the headless snapshot
 * action. Keeps the two outputs identical so the action is a faithful preview.
 */

export interface BoardTask {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly archived?: boolean
}

export interface EngineState {
  readonly taskId: string
  readonly state: string
}

export function frame(
  tasks: readonly BoardTask[],
  engineStates: Readonly<Record<string, string>>,
  cols = 80,
): string[] {
  const active = tasks.filter((t) => !t.archived)
  const lines: string[] = ["TASK BOARD", ""]
  for (const t of active) {
    const state = engineStates[t.id] ?? "idle"
    const row = `${activityGlyph(state)} ${statusGlyph(t.status)} ${t.title}`.slice(0, cols)
    lines.push(row)
  }
  if (active.length === 0) lines.push("  (no tasks)")
  return lines
}

function activityGlyph(state: string): string {
  switch (state) {
    case "running":
      return "▶"
    case "turn_complete":
      return "✓"
    case "permission_needed":
      return "?"
    case "rate_limited":
      return "⏳"
    case "error":
      return "!"
    default:
      return " "
  }
}

function statusGlyph(status: string): string {
  switch (status) {
    case "backlog":
      return "○"
    case "in_progress":
      return "●"
    case "in_review":
      return "◐"
    case "done":
      return "✓"
    case "canceled":
      return "⊘"
    default:
      return "·"
  }
}
