import type { TasksPayload } from "./protocol.ts"

/** Coalesces a burst of daemon pushes (snapshot + engine-state + inbox) into one read. */
const DEBOUNCE_MS = 250

/**
 * The task list every phone sees, recomputed when the daemon says something
 * changed and pushed only when a row a phone renders actually changed.
 * `activity.forMs` ticks on its own, so it is not a change: the phone ages
 * rows locally from the last push. `activity.since` is, so a new episode in the
 * same state (one turn ends, the next starts) still pushes a fresh base.
 */
export class TaskFeed {
  private latest: { payload: TasksPayload; readAt: number } | null = null
  private latestKey = ""
  private readonly listeners = new Set<(payload: TasksPayload) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight: Promise<TasksPayload> | null = null

  constructor(
    private readonly read: () => Promise<TasksPayload>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Something changed upstream; refresh soon. */
  poke(): void {
    if (this.listeners.size === 0 || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.refresh().catch(() => {
        // Daemon mid-restart: the next push or tick retries.
      })
    }, DEBOUNCE_MS)
  }

  /** Read now (pull-to-refresh), notifying subscribers on change. */
  refresh(): Promise<TasksPayload> {
    if (this.inflight) return this.inflight
    const p = this.read().then((payload) => {
      this.latest = { payload, readAt: this.now() }
      const key = JSON.stringify(payload, (k, v) => (k === "forMs" ? undefined : v))
      if (key !== this.latestKey) {
        this.latestKey = key
        for (const listener of this.listeners) listener(payload)
      }
      return payload
    })
    this.inflight = p
    const clear = (): void => {
      if (this.inflight === p) this.inflight = null
    }
    p.then(clear, clear)
    return p
  }

  /**
   * The cached list for a new subscriber; only the very first one costs a read. `forMs` is
   * aged by the time since that read, because the phone treats it as current on receipt.
   */
  current(): Promise<TasksPayload> {
    if (!this.latest) return this.refresh()
    const elapsed = Math.max(0, this.now() - this.latest.readAt)
    const { payload } = this.latest
    return Promise.resolve({
      ...payload,
      tasks: payload.tasks.map((t) =>
        t.activity ? { ...t, activity: { ...t.activity, forMs: t.activity.forMs + elapsed } } : t,
      ),
    })
  }

  subscribe(listener: (payload: TasksPayload) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
