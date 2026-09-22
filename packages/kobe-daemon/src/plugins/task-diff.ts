/**
 * Task-snapshot diff → plugin events. Every mutation republishes
 * `task.snapshot`, so diffing snapshots is the ONE place that sees every
 * change (RPC handlers miss e.g. `land --then-archive` and adopt).
 *
 *   - `task.changed`     — a watched field changed (`detail.fields/from/to`)
 *   - `task.pr-changed`  — prStatus changed (not in `fields`)
 *   - `worktree.created` — a `task`-kind row gained a worktree path (main/dir
 *     tasks reuse user-owned directories and never fire it)
 */

import type { SerializedTask } from "../daemon/protocol.ts"

/** Fields worth an event. Excluded on purpose: `updatedAt`/`createdAt` (they
 *  ride every change), `quotaResume` (the quota.* events cover it),
 *  `deletion` (task.deleted covers it). */
const WATCHED_FIELDS = [
  "title",
  "branch",
  "worktreePath",
  "status",
  "pinned",
  "vendor",
  "command",
  "modelEffort",
  "model",
  "tier",
  "linkedWorkItem",
  "scratch",
] as const

export type WatchedTaskField = (typeof WATCHED_FIELDS)[number]

export interface TaskFieldDiff {
  readonly fields: readonly WatchedTaskField[]
  readonly from: Record<string, unknown>
  readonly to: Record<string, unknown>
  readonly prChanged: boolean
  readonly worktreeCreated: boolean
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/**
 * Mirrors kobe's `samePrStatus` (not importable here): per-poll bookkeeping
 * must not read as change, or `task.pr-changed` fires every tick.
 */
function samePr(a: unknown, b: unknown): boolean {
  const strip = (v: unknown): unknown => {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return v
    const { lastCheckedAt: _a, lastError: _b, ...rest } = v as Record<string, unknown>
    return rest
  }
  return same(strip(a), strip(b))
}

/** Diff one task across two snapshots; null when nothing watched changed. */
export function diffTask(prev: SerializedTask, next: SerializedTask): TaskFieldDiff | null {
  const fields: WatchedTaskField[] = []
  const from: Record<string, unknown> = {}
  const to: Record<string, unknown> = {}
  for (const field of WATCHED_FIELDS) {
    const a = prev[field]
    const b = next[field]
    if (same(a, b)) continue
    fields.push(field)
    if (a !== undefined) from[field] = a
    if (b !== undefined) to[field] = b
  }
  const prChanged = !samePr(prev.prStatus, next.prStatus)
  if (fields.length === 0 && !prChanged) return null
  return {
    fields,
    from,
    to,
    prChanged,
    worktreeCreated: next.kind === "task" && !prev.worktreePath && !!next.worktreePath,
  }
}

/** `worktree.created` for a task BORN with a worktree (adopt paths). */
export function bornWithWorktree(task: SerializedTask): boolean {
  return task.kind === "task" && !!task.worktreePath
}
