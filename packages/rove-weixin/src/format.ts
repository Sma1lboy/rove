/**
 * Phone-sized text: conclusion first, one short line per item, long output
 * split into a few bubbles and then cut. Pure, so routing tests read exactly
 * what WeChat would show.
 */

import type { ContextPayload } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import type { TaskGroup } from "@sma1lboy/rove/src/lib/task-group.ts"

/** iLink chunks near 2048 chars; stay under it so one bubble stays one. */
export const BUBBLE_CHARS = 1800
/** More bubbles than this is a wall of text on a phone; the rest is cut. */
export const MAX_BUBBLES = 3
const TITLE_CHARS = 36
const ITEMS_PER_SECTION = 5

type ContextRow = ContextPayload["tasks"][number]

export function shortId(taskId: string): string {
  return taskId.slice(-6)
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Why a row sits in its group, in a few words. */
function rowDetail(row: ContextRow): string {
  const bits: string[] = []
  if (row.group === "waiting-on-you" && row.activity) bits.push(row.activity.state.replace(/_/g, " "))
  if (row.pr !== undefined) bits.push(`PR#${row.pr}`)
  if (row.checkState && row.checkState !== "none") bits.push(`CI ${row.checkState}`)
  if (row.report?.summary) bits.push(`“${clip(row.report.summary, 48)}”`)
  return bits.join(" · ")
}

export function rowLine(row: ContextRow): string {
  const detail = rowDetail(row)
  return `• ${shortId(row.taskId)} ${clip(row.title || row.branch || "(untitled)", TITLE_CHARS)}${detail ? ` — ${detail}` : ""}`
}

const SECTIONS: ReadonlyArray<readonly [TaskGroup, string]> = [
  ["waiting-on-you", "Needs you"],
  ["landing", "Ready to merge"],
  ["ready-for-review", "To review"],
  ["working", "Running"],
]

/** The status reply: counts headline, then the groups a person acts on. */
export function renderStatus(payload: ContextPayload): string {
  const count = (group: TaskGroup) => payload.tasks.filter((t) => t.group === group).length
  const needs = count("waiting-on-you")
  const merge = count("landing")
  const review = count("ready-for-review")
  const running = count("working")
  const quiet = payload.tasks.length - needs - merge - review - running + (payload.omittedTasks ?? 0)

  if (payload.tasks.length === 0) return "No tasks right now."
  const headline = [
    needs > 0 ? `${needs} need you` : null,
    merge > 0 ? `${merge} ready to merge` : null,
    review > 0 ? `${review} to review` : null,
    `${running} running`,
    quiet > 0 ? `${quiet} quiet` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const lines = [needs + merge + review === 0 ? `Nothing needs you. ${headline}` : headline]
  for (const [group, label] of SECTIONS) {
    const rows = payload.tasks.filter((t) => t.group === group)
    if (rows.length === 0) continue
    lines.push("", `${label}:`)
    for (const row of rows.slice(0, ITEMS_PER_SECTION)) lines.push(rowLine(row))
    if (rows.length > ITEMS_PER_SECTION) lines.push(`  +${rows.length - ITEMS_PER_SECTION} more`)
  }
  return lines.join("\n")
}

/**
 * Split on line boundaries into at most {@link MAX_BUBBLES} bubbles of
 * {@link BUBBLE_CHARS}; what does not fit is replaced by a cut marker.
 */
export function toBubbles(text: string): string[] {
  // A single overlong line is hard-wrapped rather than dropped.
  const pieces = text
    .trim()
    .split("\n")
    .flatMap((line) => line.match(new RegExp(`[\\s\\S]{1,${BUBBLE_CHARS}}`, "g")) ?? [""])
  const bubbles: string[] = []
  let current: string | null = null
  for (const piece of pieces) {
    if (current !== null && current.length + 1 + piece.length <= BUBBLE_CHARS) current = `${current}\n${piece}`
    else {
      if (current !== null) bubbles.push(current)
      current = piece
    }
  }
  if (current?.trim()) bubbles.push(current)
  if (bubbles.length <= MAX_BUBBLES) return bubbles

  const cutLines = bubbles.slice(MAX_BUBBLES).reduce((n, b) => n + b.split("\n").length, 0)
  const marker = `…(cut, ${cutLines} more lines)`
  const kept = bubbles.slice(0, MAX_BUBBLES)
  const last = kept[MAX_BUBBLES - 1] ?? ""
  kept[MAX_BUBBLES - 1] = `${last.slice(0, BUBBLE_CHARS - marker.length - 1)}\n${marker}`
  return kept
}
