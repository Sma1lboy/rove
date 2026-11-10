import type { TasksPayload } from "./protocol.ts"
import { type PayloadIndex, type TasksPatch, diffPayload, indexPayload } from "./tasks-patch.ts"

/**
 * How much of the bridge's time the feed may spend reading: a read that took 5 ms is followed by
 * at least 20 ms of something else. The wait before a push is sized by what a read costs, never a
 * fixed number: a fixed 250 ms here once made every change on screen a quarter second late while
 * a read took 2 ms.
 */
const READ_SHARE = 0.2
/** The longest a change waits behind an earlier read, however slow that read was. */
const MAX_WAIT_MS = 250

/**
 * The task list every phone sees, recomputed when the daemon says something
 * changed and pushed only when a row a phone renders actually changed.
 * `activity.forMs` ticks on its own, so it is not a change: the phone ages
 * rows locally from the last push. `activity.since` is, so a new episode in the
 * same state (one turn ends, the next starts) still pushes a fresh base.
 */
export class TaskFeed {
  private latest: { payload: TasksPayload; readAt: number } | null = null
  private index: PayloadIndex | null = null
  private rev = 0
  private readonly listeners = new Set<(payload: TasksPayload, patch: TasksPatch | null) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  /** When the last read finished and how long it took. */
  private lastDone = Number.NEGATIVE_INFINITY
  private lastCost = 0
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
   * Something changed upstream: read it. A change with no read just before it is read at once;
   * one that follows a read waits `READ_SHARE` worth of that read's cost, and shares the wait
   * with whatever else changes meanwhile.
   */
  poke(): void {
    if (this.listeners.size === 0 || this.timer) return
    const rest = Math.min(MAX_WAIT_MS, this.lastCost / READ_SHARE - this.lastCost)
    const wait = Math.max(0, this.lastDone + rest - this.now())
    this.timer = setTimeout(() => {
      this.timer = null
      this.refresh().catch(() => {
        // Daemon mid-restart: the next push or tick retries.
      })
    }, wait)
  }

  /** Read now (pull-to-refresh), notifying subscribers on change. */
  refresh(): Promise<TasksPayload> {
    if (this.inflight) return this.inflight
    const began = this.now()
    const p = this.read().then((payload) => {
      this.lastDone = this.now()
      this.lastCost = this.lastDone - began
      // One pass tells whether anything changed and which rows: the first read has no patch.
      const index = indexPayload(payload)
      const patch = this.index ? diffPayload(this.index, index, payload, this.rev) : null
      const changed = !this.index || patch !== null
      this.index = index
      if (changed) this.rev += 1
      const stamped = { ...payload, rev: this.rev }
      this.latest = { payload: stamped, readAt: this.lastDone }
      if (changed) for (const listener of this.listeners) listener(stamped, patch)
      return stamped
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

  /** `patch` is the change since the last push (null on the first); a listener sends whichever its client takes. */
  subscribe(listener: (payload: TasksPayload, patch: TasksPatch | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
