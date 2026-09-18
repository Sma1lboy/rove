/**
 * Kanban column math for the daemon-owned issue store — framework-free so
 * the TUI page and any future surface render from the same bucketing.
 *
 * Columns bind to the ISSUE's own lifecycle, never task status:
 *   - Done        — terminal disposition (wins over a stale task link).
 *   - Parked      — parked disposition (`hold` / unknown): work stopped on
 *                   purpose, worktree preserved — linked or not.
 *   - In progress — the issue says so (`doing`) OR it is linked to a task
 *                   (`taskId` set = started).
 *   - Backlog     — everything else (open / unlinked).
 * `in_progress` is DERIVED from the link, not stored — `kobe api issue-update
 * --task <id>` is the "move card" gesture, `--task none` moves it back. The
 * link is not the ONLY route in: `doing` is the issue's own lifecycle step
 * (`docs/WORK-TRACKING.md`: open → doing → done) and reading it needs no task
 * at all, which is what the board's `project` placement — a session that runs
 * on the main checkout with no task to link — depends on to move its card.
 */

import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { statusDisposition } from "@sma1lboy/kobe-daemon/daemon/status-disposition"

export type BoardColumnKey = "backlog" | "in_progress" | "parked" | "done"

/** Parked sits between In progress and Done: it reads as a pipeline stage —
 *  work that LEFT the active lane but isn't finished. */
const BOARD_COLUMN_ORDER: readonly BoardColumnKey[] = ["backlog", "in_progress", "parked", "done"]

/** Done and Parked both accrete forever — only the newest slice renders, the
 *  rest becomes a "+N more" count (the web board's R1 done-growth policy). */
export const COLUMN_CAP = 20

export interface IssueBoardColumn {
  key: BoardColumnKey
  issues: Issue[]
  /** Issues beyond {@link COLUMN_CAP} — rendered as a count, not cards. */
  hiddenCount: number
}

export type BoardDirection = "up" | "down" | "left" | "right"

/**
 * Keyboard cursor movement over the RENDERED board (post-cap columns):
 * up/down step within a column (clamped at the edges), left/right jump to
 * the adjacent non-empty column keeping the row (clamped to its length).
 * A missing/stale selection re-anchors on the first visible card, so a
 * cursor key always lands somewhere on a non-empty board; null only when
 * the board has no cards at all.
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
 * `taskExists` is the DEFENSIVE half of the link contract: the daemon unlinks
 * an issue when its task is deleted, so a link should always resolve — but a
 * store restored from an older home (written before that unlink existed) can
 * still carry one that doesn't. Given the predicate, an unresolvable link
 * reads as unlinked and the card falls back to Backlog, where it is startable
 * again. Omitted, the link alone decides — the behavior every caller had
 * before, and the right one for a surface that cannot see the task index.
 */
export function issueColumnKey(issue: Issue, taskExists?: (taskId: string) => boolean): BoardColumnKey {
  // Terminal disposition (today: `done`) wins over a stale task link; parked
  // (`hold` / unknown) outranks the link too — a parked story stopped on
  // purpose and must not render as active work just because it's linked.
  const disposition = statusDisposition(issue.status)
  if (disposition === "terminal") return "done"
  if (disposition === "parked") return "parked"
  if (issue.taskId !== undefined && issue.taskId !== "" && (taskExists?.(issue.taskId) ?? true)) return "in_progress"
  // The issue's own "I picked this up". Unlinked `doing` used to be
  // indistinguishable from `open`, so the documented open → doing step moved
  // no card and an agent that followed it watched its story sit in Backlog.
  if (issue.status === "doing") return "in_progress"
  return "backlog"
}

// WHICH linked tasks need a person used to be a state list right here
// (`BOARD_ATTENTION_STATES`), which is how the board ended up the last
// attention surface that had never heard of `dead`. It is the derived task
// group's job now (`lib/task-group.ts`), and `applyBoardAttention` takes the
// answer as a predicate — so this module keeps its freedom from the engine
// import AND stops holding a second, drifting copy of the rule.

/**
 * Rendering-only attention partition: float In-progress cards whose linked
 * task needs a PERSON to the head of their column (order stable
 * within both groups) and report the group size. Nothing persisted changes —
 * the card stays In progress semantically; only the view order does.
 * Unlinked issues and tasks the predicate cannot answer for stay in place.
 * `needsYou` is a PREDICATE rather than a state reader because the caller now
 * asks the derived task group (`lib/task-group.ts`), which folds the worker's
 * report and the PR observation as well as engine activity — facts this
 * module must not learn in order to stay free of those imports.
 * Only In progress is partitioned — deliberately NOT Parked: a parked card's
 * engine being blocked is often WHY it was parked (the human already saw it
 * and shelved the story), so floating it there would re-raise a handled
 * signal. Cards in Parked still show their activity badge; they just don't
 * reorder or count toward "N need you".
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
