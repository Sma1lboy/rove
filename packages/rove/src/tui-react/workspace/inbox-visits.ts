/**
 * The Inbox's RECENT order: a visit log, not `task.updatedAt` (which moves on
 * any mutation). One entry per (task, TAB), newest first, capped; per-tab
 * because switching a task's tabs is the most common move.
 */

const VISITS_KEY = "inboxVisits"
const VISIT_LIMIT = 60

export type InboxVisit = {
  readonly taskId: string
  readonly tabId: string | null
  /** Visit time, epoch ms — the age the RECENT row shows. */
  readonly at: number
}

function isVisit(value: unknown): value is InboxVisit {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.taskId === "string" &&
    (candidate.tabId === null || typeof candidate.tabId === "string") &&
    typeof candidate.at === "number"
  )
}

/** Persisted visits are user-editable JSON — drop anything malformed. */
export function parseInboxVisits(stored: unknown): InboxVisit[] {
  if (!Array.isArray(stored)) return []
  return stored.filter(isVisit).slice(0, VISIT_LIMIT)
}

/** Identity of a visit target — the (task, tab) pair a RECENT row opens. */
export function inboxVisitKey(visit: Pick<InboxVisit, "taskId" | "tabId">): string {
  return `${visit.taskId}\0${visit.tabId ?? ""}`
}

/**
 * Fold a visit into the log. One entry per (task, tab): revisiting a tab
 * moves it to the front, and a task's other tabs keep their own entries.
 */
export function recordInboxVisit(visits: readonly InboxVisit[], visit: InboxVisit, limit = VISIT_LIMIT): InboxVisit[] {
  const key = inboxVisitKey(visit)
  const rest = visits.filter((entry) => inboxVisitKey(entry) !== key)
  return [visit, ...rest].slice(0, limit)
}

/** Visits newest-first, deduped by (task, tab) — position 0 is the most recent. */
export function inboxVisitIndex(visits: readonly InboxVisit[]): Map<string, InboxVisit> {
  const byTarget = new Map<string, InboxVisit>()
  for (const visit of visits) {
    const key = inboxVisitKey(visit)
    if (!byTarget.has(key)) byTarget.set(key, visit)
  }
  return byTarget
}

type VisitKV = { get(key: string, defaultValue?: unknown): unknown; set(key: string, value: unknown): void }

export function readInboxVisits(kv: VisitKV): InboxVisit[] {
  return parseInboxVisits(kv.get(VISITS_KEY))
}

export function writeInboxVisit(kv: VisitKV, visit: InboxVisit): void {
  const visits = readInboxVisits(kv)
  const [previous] = visits
  // Already on top: skip. Activation re-fires on remount, so this keeps `at`
  // meaning "when you last came here" and persisted writes rare.
  if (previous?.taskId === visit.taskId && previous.tabId === visit.tabId) return
  kv.set(VISITS_KEY, recordInboxVisit(visits, visit))
}
