/**
 * Field-level task-snapshot diff → product plugin events.
 *
 * Every task mutation — whatever RPC, collector, or orchestrator path made it
 * — funnels through the store and republishes `task.snapshot`, so diffing
 * consecutive snapshots is the ONE place that observes every change. This is
 * what fixes the historical drops: archive-via-worktree-removal, archive from
 * `land --then-archive`, and worktree materialization via adopt all bypassed
 * the RPC handlers that used to emit events.
 *
 * Emitted per changed task:
 *   - `task.changed`     — any watched field changed (`detail.fields/from/to`)
 *   - `task.pr-changed`  — prStatus changed (its own event, not in `fields`)
 *   - `task.archived`    — archived flipped false→true (restores don't fire)
 *   - `worktree.created` — a `task`-kind row gained a worktree path (lazy
 *     ensure, adopt, and scratch-adopt all land here; main/dir tasks reuse
 *     user-owned directories and never "materialize" one)
 */

import type { SerializedTask } from "../daemon/protocol.ts"

/** Fields worth an event. Excluded on purpose: `position` (drag ordering
 *  noise), `updatedAt`/`createdAt` (ride every change), `quotaResume`
 *  (the quota.* events cover it), `deletion` (task.deleted covers it). */
const WATCHED_FIELDS = [
  "title",
  "branch",
  "worktreePath",
  "status",
  "archived",
  "pinned",
  "vendor",
  "command",
  "modelEffort",
  "linkedWorkItem",
  "scratch",
] as const

export type WatchedTaskField = (typeof WATCHED_FIELDS)[number]

export interface TaskFieldDiff {
  readonly fields: readonly WatchedTaskField[]
  readonly from: Record<string, unknown>
  readonly to: Record<string, unknown>
  readonly archivedNow: boolean
  readonly prChanged: boolean
  readonly worktreeCreated: boolean
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b)
  return false
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
  const prChanged = !same(prev.prStatus, next.prStatus)
  if (fields.length === 0 && !prChanged) return null
  return {
    fields,
    from,
    to,
    archivedNow: !prev.archived && next.archived,
    prChanged,
    worktreeCreated: next.kind === "task" && !prev.worktreePath && !!next.worktreePath,
  }
}

/** `worktree.created` for a task BORN with a worktree (adopt paths). */
export function bornWithWorktree(task: SerializedTask): boolean {
  return task.kind === "task" && !!task.worktreePath
}
