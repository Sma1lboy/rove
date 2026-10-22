/**
 * The daemon's tab store: the one writer of every task's terminal tabs.
 * Clients (TUIs, the CLI, the bridge) send `tabs.apply` operations; the store
 * applies them in arrival order, bumps a revision and publishes the task's
 * whole tab state on `tabs.changed`, so every attached client renders the
 * same list. Persistence is injected (`DaemonRuntimeAdapter.tabsPersistence`):
 * the rove side keeps the `terminalTabs.<taskId>` keys of state.json, which
 * every older reader still reads, and the daemon is the only one writing them.
 */

import type { DaemonEventBus } from "./event-bus.ts"
import { logDaemonError } from "./crash-log.ts"
import {
  type SharedTabs,
  type TabOp,
  applyTabOps,
  releaseOrdinals,
  reserveOrdinals,
} from "./tabs-ops.ts"

export interface TabsPersistence {
  /** Every task's saved tabs, keyed by task id. */
  load(): Record<string, SharedTabs>
  /** Write these tasks' tabs (null = delete the record). */
  save(changes: Readonly<Record<string, SharedTabs | null>>): void
}

export interface TabsChangedPayload {
  readonly taskId: string
  /** The whole state after the change; null = the task has no tabs record any more. */
  readonly state: SharedTabs | null
  /** Store-wide, monotonically increasing: a client keeps the newest it has seen. */
  readonly rev: number
  readonly at: number
}

/** Closed ids remembered per task: enough to outlast any stale copy or a slow orphan poll. */
const TOMBSTONE_CAP = 256
const SAVE_DEBOUNCE_MS = 100

export class TabsStore {
  private readonly tabs = new Map<string, SharedTabs>()
  private readonly revs = new Map<string, number>()
  private readonly tombstones = new Map<string, Set<string>>()
  private rev = 0
  private readonly dirty = new Map<string, SharedTabs | null>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly persistence: TabsPersistence | undefined,
    private readonly bus: Pick<DaemonEventBus, "publish">,
  ) {}

  init(): void {
    if (!this.persistence) return
    try {
      for (const [taskId, state] of Object.entries(this.persistence.load())) {
        if (state && Array.isArray(state.tabs)) this.tabs.set(taskId, state)
      }
    } catch (err) {
      logDaemonError("tabs-load", err)
    }
  }

  get(taskId: string): { state: SharedTabs | null; rev: number } {
    return { state: this.tabs.get(taskId) ?? null, rev: this.revs.get(taskId) ?? 0 }
  }

  list(): { tasks: Record<string, SharedTabs>; rev: number } {
    return { tasks: Object.fromEntries(this.tabs), rev: this.rev }
  }

  apply(taskId: string, ops: readonly TabOp[]): { state: SharedTabs | null; rev: number; opened: readonly (string | null)[] } {
    const result = applyTabOps(this.tabs.get(taskId) ?? null, ops, this.tombstonesOf(taskId))
    if (result.changed) this.commit(taskId, result.state, true)
    return { state: result.state, rev: this.revs.get(taskId) ?? this.rev, opened: result.opened }
  }

  /** Hand a client `count` ordinals of its own; ids it mints from them collide with nobody's. */
  reserve(taskId: string, count: number): { from: number; to: number } {
    const n = Math.max(1, Math.min(16, Math.floor(count)))
    const { state, from } = reserveOrdinals(this.tabs.get(taskId) ?? null, n)
    // Not broadcast: the counter is invisible until a tab uses it.
    this.commit(taskId, state, false)
    return { from, to: from + n }
  }

  release(taskId: string, from: number, to: number): void {
    const current = this.tabs.get(taskId) ?? null
    const next = releaseOrdinals(current, from, to)
    if (next && next !== current) this.commit(taskId, next, false)
  }

  /** Task deleted: drop its record and tombstones. */
  forget(taskId: string): void {
    this.tombstones.delete(taskId)
    if (this.tabs.has(taskId)) this.commit(taskId, null, true)
  }

  /** Write pending changes now (daemon shutdown). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.dirty.size === 0 || !this.persistence) return
    const changes = Object.fromEntries(this.dirty)
    this.dirty.clear()
    try {
      this.persistence.save(changes)
    } catch (err) {
      logDaemonError("tabs-save", err)
    }
  }

  private commit(taskId: string, state: SharedTabs | null, publish: boolean): void {
    if (state) this.tabs.set(taskId, state)
    else this.tabs.delete(taskId)
    this.dirty.set(taskId, state)
    this.timer ??= setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS)
    if (!publish) return
    this.rev += 1
    this.revs.set(taskId, this.rev)
    this.bus.publish("tabs.changed", { taskId, state, rev: this.rev, at: Date.now() })
  }

  private tombstonesOf(taskId: string): Set<string> {
    let set = this.tombstones.get(taskId)
    if (!set) {
      set = new Set()
      this.tombstones.set(taskId, set)
    }
    if (set.size > TOMBSTONE_CAP) {
      const keep = [...set].slice(-TOMBSTONE_CAP / 2)
      set.clear()
      for (const id of keep) set.add(id)
    }
    return set
  }
}
