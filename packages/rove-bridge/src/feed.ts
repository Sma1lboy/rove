import type { TasksPayload } from "./protocol.ts"

/** The least time between two reads: a burst of daemon pushes (snapshot + engine-state + inbox) costs one more. */
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
  private lastRead = Number.NEGATIVE_INFINITY
  private inflight: Promise<TasksPayload> | null = null

  constructor(
    private readonly read: () => Promise<TasksPayload>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Is anyone listening? A poll for upstream changes is only worth running when so. */
  get active(): boolean {
    return this.listeners.size > 0
  }

  /**
   * Something changed upstream. The first change after a quiet spell is read at once, so a click
   * shows without the wait; what follows within the window shares one later read.
   */
  poke(): void {
    if (this.listeners.size === 0 || this.timer) return
    const wait = Math.max(0, this.lastRead + DEBOUNCE_MS - this.now())
    this.timer = setTimeout(() => {
      this.timer = null
      this.lastRead = this.now()
      this.refresh().catch(() => {
        // Daemon mid-restart: the next push or tick retries.
      })
    }, wait)
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
