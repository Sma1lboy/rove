import { attentionInboxItemKey } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { AttentionInboxItem } from "../../client/remote-orchestrator"
import { compareRecent } from "../../tui/panes/sidebar/groups"
import type { Task } from "../../types/task"
import { type InboxVisit, inboxVisitIndex } from "./inbox-visits"

export const attentionInboxKey = attentionInboxItemKey

export function attentionInboxCounts(items: readonly AttentionInboxItem[]): { total: number } {
  return { total: items.length }
}

/** Episodes RESOLVED by visiting their target. Tab-scoped episodes match the
 *  exact (task, tab); task-level ones (tabId null) match any visit to the task. */
export function visitResolvedEpisodes(
  items: readonly AttentionInboxItem[],
  visit: { taskId: string; tabId: string | null },
): AttentionInboxItem[] {
  return items.filter((item) => item.taskId === visit.taskId && (item.tabId === null || item.tabId === visit.tabId))
}

/**
 * Whether an episode's target still exists. `hasTab` is TRI-STATE: `false` =
 * tab gone; `undefined` = tab list unreadable (never mounted). Callers DELETE
 * unavailable episodes from the daemon, so unknown must keep the episode.
 */
export function isAttentionInboxItemAvailable(
  item: AttentionInboxItem,
  task: Pick<Task, "deletion"> | undefined,
  hasTab: (tabId: string) => boolean | undefined,
): boolean {
  // A routine episode targets the SCHEDULE, which exists even when the firing
  // produced no task; the task lookup would mark it garbage and delete it.
  if (item.state === "routine_failed") return true
  if (item.taskId === null || task === undefined || task.deletion) return false
  if (item.tabId === null) return true
  return hasTab(item.tabId) !== false
}

export function partitionAttentionInboxAvailability(
  items: readonly AttentionInboxItem[],
  tasks: readonly Pick<Task, "id" | "deletion">[],
  hasTab: (taskId: string, tabId: string) => boolean | undefined,
): { availableItems: AttentionInboxItem[]; unavailableItems: AttentionInboxItem[] } {
  const tasksById = new Map<string, Pick<Task, "id" | "deletion">>(tasks.map((task) => [task.id, task]))
  const availableItems: AttentionInboxItem[] = []
  const unavailableItems: AttentionInboxItem[] = []
  for (const item of items) {
    const taskId = item.taskId
    const available = isAttentionInboxItemAvailable(
      item,
      taskId === null ? undefined : tasksById.get(taskId),
      (tabId) => (taskId === null ? undefined : hasTab(taskId, tabId)),
    )
    if (available) availableItems.push(item)
    else unavailableItems.push(item)
  }
  return { availableItems, unavailableItems }
}

/**
 * Band 0 BLOCKS on a human; `turn_complete` alone trails. Named as the
 * exception so a new `ATTENTION_INBOX_STATES` entry defaults to blocking,
 * the safe mis-sort (one extra F7 press vs buried behind finished turns).
 */
function inboxBand(item: AttentionInboxItem): 0 | 1 {
  return item.state === "turn_complete" ? 1 : 0
}

/** Blocked episodes first, then oldest-first within each band (task order
 *  breaks same-instant ties), so a stuck agent never waits behind finished turns. */
export function sortAttentionInbox(
  items: readonly AttentionInboxItem[],
  taskOrder: readonly string[],
): AttentionInboxItem[] {
  const taskIndex = new Map(taskOrder.map((id, index) => [id, index]))
  return [...items].sort((a, b) => {
    const band = inboxBand(a) - inboxBand(b)
    if (band !== 0) return band
    const age = a.at - b.at
    if (age !== 0) return age
    const task =
      (taskIndex.get(a.taskId ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (taskIndex.get(b.taskId ?? "") ?? Number.MAX_SAFE_INTEGER)
    if (task !== 0) return task
    return attentionInboxItemKey(a).localeCompare(attentionInboxItemKey(b))
  })
}

/** How many RECENT tasks trail the attention queue. */
const INBOX_RECENT_LIMIT = 5

export type InboxRow =
  | { readonly kind: "header"; readonly id: string; readonly section: "attention" | "recent" }
  | { readonly kind: "attention"; readonly id: string; readonly item: AttentionInboxItem }
  | {
      readonly kind: "recent"
      readonly id: string
      readonly task: Task
      /** The tab you were last on in this task, when one was recorded. */
      readonly tabId: string | null
      /** Last visit time, or the task's own mtime when never visited. */
      readonly at: number
    }

/**
 * ONE list, two sections: pending episodes on top, then the TABS you most
 * recently VISITED, per (task, tab). A target with a pending episode is not
 * repeated below (a task-level episode covers all its tabs); nor is the tab
 * you're on.
 *
 * Visit order comes from the log (`inbox-visits.ts`), not `updatedAt`:
 * "where was I" is not "what changed". Never-visited tasks trail as one
 * task-level row each, by mtime, so a fresh install has a RECENT section.
 */
export function inboxRows(
  items: readonly AttentionInboxItem[],
  tasks: readonly Task[],
  options: {
    selectedId?: string | null
    /** The tab you're looking at right now, when the selected task has one. */
    selectedTabId?: string | null
    recentLimit?: number
    visits?: readonly InboxVisit[]
    /** TRI-STATE tab existence (see `taskTabExists`). The visit log is never
     *  pruned on close, so a confirmed-gone tab drops its row; `undefined` keeps it. */
    tabExists?: (taskId: string, tabId: string) => boolean | undefined
  } = {},
): InboxRow[] {
  const attention = sortAttentionInbox(
    items,
    tasks.map((task) => task.id),
  )
  const tasksById = new Map(tasks.map((task) => [String(task.id), task]))
  // A visited row is duplicated only by an episode on THAT tab or a task-level
  // one; an unvisited (task-level) row by any episode on its task.
  const pendingTasks = new Set(items.map((item) => item.taskId))
  const coveredTab = (taskId: string, tabId: string | null): boolean =>
    items.some((item) => item.taskId === taskId && (item.tabId === null || item.tabId === tabId))
  const visited = [...inboxVisitIndex(options.visits ?? []).values()]
  // No known active tab → hide the whole selected task.
  const isSelected = (taskId: string, tabId: string | null): boolean =>
    taskId === options.selectedId && (options.selectedTabId == null || tabId === options.selectedTabId)
  const tabAlive = (visit: InboxVisit): boolean =>
    visit.tabId === null || options.tabExists?.(visit.taskId, visit.tabId) !== false
  const visitedRows = visited
    .map((visit) => ({ visit, task: tasksById.get(visit.taskId) }))
    .filter(
      (entry): entry is { visit: InboxVisit; task: Task } =>
        entry.task !== undefined &&
        !entry.task.deletion &&
        tabAlive(entry.visit) &&
        !coveredTab(entry.visit.taskId, entry.visit.tabId) &&
        !isSelected(entry.visit.taskId, entry.visit.tabId),
    )
    .map(({ visit, task }) => ({
      kind: "recent" as const,
      id: visit.tabId ? `r:${visit.taskId}:${visit.tabId}` : `r:${visit.taskId}`,
      task,
      tabId: visit.tabId,
      at: visit.at,
    }))
  const seenTasks = new Set(visited.map((visit) => visit.taskId))
  const unvisitedRows = tasks
    .filter(
      (task) =>
        !task.deletion && !seenTasks.has(task.id) && !pendingTasks.has(task.id) && task.id !== options.selectedId,
    )
    .sort(compareRecent)
    .map((task) => ({ kind: "recent" as const, id: `r:${task.id}`, task, tabId: null, at: taskMtime(task) }))
  const recent = [...visitedRows, ...unvisitedRows].slice(0, options.recentLimit ?? INBOX_RECENT_LIMIT)
  const rows: InboxRow[] = []
  if (attention.length > 0) {
    rows.push({ kind: "header", id: "header:attention", section: "attention" })
    for (const item of attention) rows.push({ kind: "attention", id: `a:${attentionInboxItemKey(item)}`, item })
  }
  if (recent.length > 0) {
    rows.push({ kind: "header", id: "header:recent", section: "recent" })
    rows.push(...recent)
  }
  return rows
}

function taskMtime(task: Task): number {
  const parsed = Date.parse(task.updatedAt || task.createdAt)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Cursor movement that steps over section headers, wrapping both ways. */
export function nextSelectableRow(rows: readonly InboxRow[], from: number, delta: 1 | -1): number {
  const total = rows.length
  let index = from
  for (let step = 0; step < total; step++) {
    index = (index + delta + total) % total
    if (rows[index]?.kind !== "header") return index
  }
  return from
}

/** Clamp a stale cursor back onto a selectable row after the list changes. */
export function clampSelectableRow(rows: readonly InboxRow[], cursor: number): number {
  if (rows.length === 0) return 0
  const bounded = Math.min(Math.max(cursor, 0), rows.length - 1)
  return rows[bounded]?.kind === "header" ? nextSelectableRow(rows, bounded, 1) : bounded
}

export type InboxWindow = {
  readonly visible: InboxRow[]
  /** CARDS clipped above/below the window (headers are never counted). */
  readonly hiddenAbove: number
  readonly hiddenBelow: number
}

/**
 * Rows the pane can show. `budget` counts CARDS only (a header is one line to
 * a card's three). The window keeps the cursor's card inside; clipped counts
 * feed the pane's "+N more" lines.
 */
export function windowInboxRows(rows: readonly InboxRow[], cursor: number, budget: number): InboxWindow {
  const cardIndexes = rows.reduce<number[]>((acc, row, index) => {
    if (row.kind !== "header") acc.push(index)
    return acc
  }, [])
  if (cardIndexes.length <= budget) return { visible: [...rows], hiddenAbove: 0, hiddenBelow: 0 }
  const cursorCard = Math.max(0, cardIndexes.indexOf(clampSelectableRow(rows, cursor)))
  const firstCard = Math.max(0, Math.min(cursorCard - budget + 1, cardIndexes.length - budget))
  const lastCard = firstCard + budget - 1
  // A window starting at a section's first card keeps that section's header.
  const start = firstCard === 0 ? 0 : (cardIndexes[firstCard] ?? 0)
  const startWithHeader = start > 0 && rows[start - 1]?.kind === "header" ? start - 1 : start
  const end = (cardIndexes[lastCard] ?? rows.length - 1) + 1
  return {
    visible: rows.slice(startWithHeader, end),
    hiddenAbove: firstCard,
    hiddenBelow: cardIndexes.length - lastCard - 1,
  }
}

/**
 * Pick the next pending episode (oldest first). Unavailable episodes are
 * excluded while the Inbox pane's silent cleanup drains them.
 */
export function nextAttentionInboxTarget(
  items: readonly AttentionInboxItem[],
  taskOrder: readonly string[],
  current: { taskId: string | null; tabId: string | null },
  isAvailable: (item: AttentionInboxItem) => boolean = () => true,
): AttentionInboxItem | null {
  const liveTasks = new Set(taskOrder)
  const ordered = sortAttentionInbox(items, taskOrder).filter(
    // A routine episode targets the SCHEDULE (opens the Routines page), so a
    // live task must not gate it, or F7 skips a listed episode forever.
    (item) =>
      (item.state === "routine_failed" || item.taskId === null || liveTasks.has(item.taskId)) && isAvailable(item),
  )
  if (ordered.length === 0) return null
  const currentKey = current.taskId === null ? null : attentionInboxItemKey(current)
  const currentIndex =
    currentKey === null ? -1 : ordered.findIndex((item) => attentionInboxItemKey(item) === currentKey)
  if (currentIndex < 0) return ordered[0] ?? null
  // The sole episode may be the current tab; returning it lets F7 resolve it.
  if (ordered.length === 1) return ordered[0] ?? null
  return ordered[(currentIndex + 1) % ordered.length] ?? null
}
