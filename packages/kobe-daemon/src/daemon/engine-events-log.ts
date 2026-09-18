/**
 * Per-task ring buffer of recent engine lifecycle events — the data behind
 * the TUI's task event feed (`task.recentEvents` RPC). In-memory only:
 * the feed is a debugging/observability surface, not durable history (the
 * engine transcript is), so a daemon restart starting empty is fine.
 */

import type { EngineActivityDetail } from "./contracts.ts"

export interface RecentEngineEvent {
  readonly kind: string
  readonly tabId?: string
  readonly vendor?: string
  readonly detail?: EngineActivityDetail
  readonly at: number
}

export const PER_TASK_CAP = 100
/** Task-count ceiling. Eviction is recency-based (see `append`): the
 *  least-recently-appended task is dropped, never an active one. */
export const TASK_CAP = 100

export class EngineEventLog {
  private readonly byTask = new Map<string, RecentEngineEvent[]>()

  append(taskId: string, event: RecentEngineEvent): void {
    let list = this.byTask.get(taskId)
    if (list) {
      // Touching an existing task must move it to the Map's tail so the head
      // stays the least-recently-active task. A `Map` only appends on a NEW
      // key — `set` on an existing one keeps its original slot — so an
      // in-place `get`+push leaves insertion order frozen at first-append
      // (FIFO), and eviction below then drops whichever task was seen first,
      // even one being appended to right now. Delete + re-set re-keys it.
      this.byTask.delete(taskId)
    } else if (this.byTask.size >= TASK_CAP) {
      const oldest = this.byTask.keys().next().value
      if (oldest !== undefined) this.byTask.delete(oldest)
    }
    if (!list) list = []
    this.byTask.set(taskId, list)
    list.push(event)
    if (list.length > PER_TASK_CAP) list.splice(0, list.length - PER_TASK_CAP)
  }

  /** Newest last. */
  recent(taskId: string, limit = PER_TASK_CAP): readonly RecentEngineEvent[] {
    const list = this.byTask.get(taskId) ?? []
    return limit >= list.length ? [...list] : list.slice(-limit)
  }

  clearTask(taskId: string): void {
    this.byTask.delete(taskId)
  }
}
