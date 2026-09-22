/**
 * Framework-free kanban bucketing of the issue store. Columns follow the
 * ISSUE's lifecycle, never task status:
 *   - Done        — terminal disposition (wins over a stale task link).
 *   - Parked      — parked disposition (`hold` / unknown): stopped on purpose,
 *                   worktree preserved — linked or not.
 *   - In progress — `doing`, OR linked to a task (`taskId` set = started).
 *   - Backlog     — everything else.
 * The link is derived, not stored: `issue-update --task <id>` moves the card,
 * `--task none` moves it back. `doing` needs no task, which the `project`
 * placement (main checkout, nothing to link) relies on.
 */

import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { statusDisposition } from "@sma1lboy/kobe-daemon/daemon/status-disposition"

export type BoardColumnKey = "backlog" | "in_progress" | "parked" | "done"

/** Parked between In progress and Done: left the active lane, not finished. */
const BOARD_COLUMN_ORDER: readonly BoardColumnKey[] = ["backlog", "in_progress", "parked", "done"]

/** Done and Parked accrete forever: newest slice renders, the rest is "+N more"
 *  (web board R1 policy). */
export const COLUMN_CAP = 20

export interface IssueBoardColumn {
  key: BoardColumnKey
  issues: Issue[]
  /** Issues beyond {@link COLUMN_CAP} — rendered as a count, not cards. */
  hiddenCount: number
}

export type BoardDirection = "up" | "down" | "left" | "right"

/**
 * Over the RENDERED (post-cap) board: up/down clamp within a column,
 * left/right jump to the next non-empty column keeping the row (clamped). A
 * stale selection re-anchors on the first card; null only for an empty board.
 */
export function moveBoardSelection(
  columns: readonly IssueBoardColumn[],
  currentId: number | null,
  dir: BoardDirection,
): number | null {
  const firstVisible = columns.find((column) => column.issues.length > 0)?.issues[0]?.id ?? null
  if (currentId == null) return firstVisible
  let col = -1
  let row = -1
  for (const [c, column] of columns.entries()) {
    const r = column.issues.findIndex((issue) => issue.id === currentId)
    if (r !== -1) {
      col = c
      row = r
      break
    }
  }
  if (col === -1) return firstVisible
  if (dir === "up" || dir === "down") {
    const column = columns[col]?.issues ?? []
    const next = dir === "up" ? row - 1 : row + 1
    return column[Math.max(0, Math.min(next, column.length - 1))]?.id ?? currentId
  }
  const step = dir === "left" ? -1 : 1
  for (let c = col + step; c >= 0 && c < columns.length; c += step) {
    const column = columns[c]?.issues ?? []
    if (column.length === 0) continue
    return column[Math.min(row, column.length - 1)]?.id ?? currentId
  }
  return currentId
}

/**
 * `taskExists` is defensive: the daemon unlinks on task delete, but a store
 * from an older home can carry a dangling link; with the predicate it reads
 * as unlinked (back to Backlog, startable). Omit it on surfaces that can't see
 * the task index — then the link alone decides.
 */
export function issueColumnKey(issue: Issue, taskExists?: (taskId: string) => boolean): BoardColumnKey {
  // Terminal and parked both outrank a link: a parked story must not render
  // as active work.
  const disposition = statusDisposition(issue.status)
  if (disposition === "terminal") return "done"
  if (disposition === "parked") return "parked"
  if (issue.taskId !== undefined && issue.taskId !== "" && (taskExists?.(issue.taskId) ?? true)) return "in_progress"
  // Unlinked `doing`: the documented open → doing step must move the card.
  if (issue.status === "doing") return "in_progress"
  return "backlog"
}

/**
 * View-only: float In-progress cards whose task needs a PERSON to the column
 * head (stable order) and count them; nothing persisted changes. `needsYou`
 * is a predicate so the rule stays in `lib/task-group.ts` (engine activity,
 * worker report, PR) without those imports here. NOT Parked: a blocked engine
 * is often why it was parked, so floating it re-raises a handled signal.
 */
export function applyBoardAttention(
  columns: readonly IssueBoardColumn[],
  needsYou: (taskId: string) => boolean,
): { columns: readonly IssueBoardColumn[]; attentionCount: number } {
  let attentionCount = 0
  const next = columns.map((col) => {
    if (col.key !== "in_progress") return col
    const attention: Issue[] = []
    const rest: Issue[] = []
    for (const issue of col.issues) {
      const linked = issue.taskId !== undefined && issue.taskId !== ""
      if (linked && needsYou(issue.taskId as string)) attention.push(issue)
      else rest.push(issue)
    }
    attentionCount = attention.length
    return attention.length === 0 ? col : { ...col, issues: [...attention, ...rest] }
  })
  return { columns: next, attentionCount }
}

/** Newest-created first; id desc as the tiebreak (`created` is day-granular). */
export function compareIssues(a: Issue, b: Issue): number {
  if (a.created !== b.created) return a.created < b.created ? 1 : -1
  return b.id - a.id
}

/** Bucket issues into the four render-ready columns, sorted; the accreting
 *  columns (Parked, Done) are capped. */
export function buildIssueBoard(
  issues: readonly Issue[],
  taskExists?: (taskId: string) => boolean,
): IssueBoardColumn[] {
  const buckets: Record<BoardColumnKey, Issue[]> = { backlog: [], in_progress: [], parked: [], done: [] }
  for (const issue of issues) buckets[issueColumnKey(issue, taskExists)].push(issue)
  return BOARD_COLUMN_ORDER.map((key) => {
    const capped = key === "done" || key === "parked"
    const sorted = buckets[key].sort(compareIssues)
    if (!capped || sorted.length <= COLUMN_CAP) return { key, issues: sorted, hiddenCount: 0 }
    return { key, issues: sorted.slice(0, COLUMN_CAP), hiddenCount: sorted.length - COLUMN_CAP }
  })
}
