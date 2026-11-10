/**
 * The daemon's dispatch ledger: every prompt one session hands another (`api send`,
 * `api dispatch`, `api add` with a dispatcher, a routine firing) and how far it got —
 * delivered, the target's engine working on it, asking, done, failed. Published whole on
 * `dispatch.snapshot` after every change, so a client that (re)connects sees what is still
 * in flight instead of reconstructing it from events it missed.
 *
 * Display-only: it owes nobody a report and never blocks should-run. That is the
 * deliveries store's job (`deliveries-store.ts`); an armed row links its delivery by id.
 */

import type { TaskActivityState } from "./contracts.ts"
import type { DaemonEventBus } from "./event-bus.ts"

export type DispatchKind = "send" | "dispatch" | "add" | "routine"
export type DispatchStatus = "delivered" | "working" | "asking" | "done" | "failed"

export interface DispatchEnd {
  readonly taskId: string
  /** `null` until the landing tab is known. */
  readonly tabId: string | null
}

export interface DispatchRow {
  /** `x-<n>`, monotonic per daemon run. */
  readonly id: string
  readonly kind: DispatchKind
  /** The sending session; `null` = the owner (no verified rove session sent it), or a routine. */
  readonly from: DispatchEnd | null
  /** The routine's name, for `kind: "routine"`. */
  readonly routine?: string
  readonly to: DispatchEnd
  readonly promptHead: string
  /** Epoch ms. */
  readonly at: number
  readonly status: DispatchStatus
  readonly statusAt: number
  /** Why it failed. */
  readonly reason?: string
  readonly deliveryId?: string
}

export interface DispatchSnapshot {
  readonly rows: readonly DispatchRow[]
  /** Rises on every change; a client keeps the newest. */
  readonly rev: number
}

export interface DispatchInput {
  readonly kind: DispatchKind
  readonly from: DispatchEnd | null
  readonly routine?: string
  readonly to: DispatchEnd
  readonly promptHead: string
  readonly delivered: boolean
  readonly reason?: string
  readonly deliveryId?: string
}

export const DISPATCH_PROMPT_HEAD_CHARS = 160
/** Settled rows kept for the view's recent history. */
const KEEP_SETTLED = 40
/** In-flight rows kept at most; past it the oldest go. */
const KEEP_OPEN = 100
/** An in-flight row nothing has moved for this long is dropped, not shown forever. */
const OPEN_TTL_MS = 6 * 60 * 60_000

const SETTLED: ReadonlySet<DispatchStatus> = new Set(["done", "failed"])

/** Where one engine-state report moves an in-flight row; undefined = it does not. */
function next(status: DispatchStatus, state: TaskActivityState): DispatchStatus | undefined {
  if (state === "error" || state === "dead") return "failed"
  if (state === "running" && (status === "delivered" || status === "asking")) return "working"
  if (state === "permission_needed" && (status === "delivered" || status === "working")) return "asking"
  // A turn end before the engine started ours belongs to the prompt it was still on.
  if ((state === "turn_complete" || state === "idle") && (status === "working" || status === "asking")) return "done"
  return undefined
}

// ponytail: in memory, so `rove daemon restart` drops in-flight rows; persist beside
// deliveries if the view has to survive a restart.
export class DispatchLedger {
  private rows: DispatchRow[] = []
  private seq = 1
  private rev = 0
  private expiry: ReturnType<typeof setTimeout> | null = null
  /** Other machines' tasks the hub's last relay had a reading for. */
  private relayed: ReadonlySet<string> = new Set()
  private readonly off: () => void
  private readonly now: () => number

  constructor(
    private readonly bus: Pick<DaemonEventBus, "publish" | "onPublish">,
    now?: () => number,
  ) {
    this.now = now ?? Date.now
    this.off = bus.onPublish((event) => {
      if (event.channel === "engine-state") this.take(event.payload)
      // Another machine's task, sent to from here: its readings arrive as the hub's relay.
      else if (event.channel === "machines") this.takeRelayed(event.payload)
    })
  }

  list(): DispatchSnapshot {
    return { rows: this.rows, rev: this.rev }
  }

  record(input: DispatchInput): DispatchRow {
    const at = this.now()
    const row: DispatchRow = {
      id: `x-${this.seq++}`,
      kind: input.kind,
      from: input.from,
      ...(input.routine ? { routine: input.routine } : {}),
      to: input.to,
      promptHead: input.promptHead.replace(/\s+/g, " ").trim().slice(0, DISPATCH_PROMPT_HEAD_CHARS),
      at,
      status: input.delivered ? "delivered" : "failed",
      statusAt: at,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
    }
    this.rows = [...this.rows, row]
    this.publish()
    return row
  }

  close(): void {
    this.off()
    this.clearExpiry()
  }

  private take(payload: unknown): void {
    const p = payload as { taskId?: unknown; tabId?: unknown; state?: unknown; at?: unknown }
    if (typeof p.taskId !== "string" || typeof p.state !== "string") return
    const tabId = typeof p.tabId === "string" && p.tabId ? p.tabId : null
    const at = typeof p.at === "number" ? p.at : this.now()
    let changed = false
    this.rows = this.rows.map((row) => {
      if (SETTLED.has(row.status) || row.to.taskId !== p.taskId || at < row.at) return row
      if (row.to.tabId !== null && tabId !== null && row.to.tabId !== tabId) return row
      const status = next(row.status, p.state as TaskActivityState)
      if (!status) return row
      changed = true
      return {
        ...row,
        to: row.to.tabId === null && tabId !== null ? { ...row.to, tabId } : row.to,
        status,
        statusAt: at,
        ...(status === "failed" ? { reason: p.state as string } : {}),
      }
    })
    if (changed) this.publish()
  }

  private takeRelayed(payload: unknown): void {
    const activity = (payload as { live?: { activity?: unknown } } | null)?.live?.activity
    if (!activity || typeof activity !== "object") return
    const seen = new Set<string>()
    for (const [taskId, reading] of Object.entries(activity)) {
      if (!reading || typeof reading !== "object") continue
      seen.add(taskId)
      this.take({ ...reading, taskId })
    }
    // The relay holds no idle readings: a task that drops out of it has gone idle.
    for (const taskId of this.relayed) if (!seen.has(taskId)) this.take({ taskId, state: "idle", at: this.now() })
    this.relayed = seen
  }

  private publish(): void {
    this.rows = prune(this.rows, this.now())
    this.rev += 1
    this.bus.publish("dispatch.snapshot", this.list())
    this.scheduleExpiry()
  }

  /** A stuck row must leave on its own: on a quiet daemon no other change would publish the prune. */
  private scheduleExpiry(): void {
    this.clearExpiry()
    const open = this.rows.filter((r) => !SETTLED.has(r.status))
    if (open.length === 0) return
    const due = Math.min(...open.map((r) => r.statusAt)) + OPEN_TTL_MS
    this.expiry = setTimeout(
      () => {
        this.expiry = null
        if (prune(this.rows, this.now()).length !== this.rows.length) this.publish()
        else this.scheduleExpiry()
      },
      Math.max(0, due - this.now()),
    )
    this.expiry.unref?.()
  }

  private clearExpiry(): void {
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = null
  }
}

function prune(rows: readonly DispatchRow[], now: number): DispatchRow[] {
  const open = rows.filter((r) => !SETTLED.has(r.status) && now - r.statusAt < OPEN_TTL_MS).slice(-KEEP_OPEN)
  const settled = rows.filter((r) => SETTLED.has(r.status)).slice(-KEEP_SETTLED)
  const keep = new Set([...open, ...settled])
  return rows.filter((r) => keep.has(r))
}
