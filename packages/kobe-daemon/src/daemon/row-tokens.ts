/**
 * Plugin-written task-row tokens — the one place a third party can put
 * characters on a task row (docs/design/herdr-gap-analysis.md item 8).
 *
 * Rove gave plugins ~40 events, panes, settings, actions and engines, and no
 * way to label a row. That is why nobody could build a coordination plugin on
 * top of Rove: the whole point of one is to say, on the row, who claimed this
 * / what queue it is in / what your own system thinks of it.
 *
 * ## In memory, never on disk
 *
 * A token is a CLAIM WITH A DEADLINE, not a fact. Every write carries a TTL,
 * readers drop what has expired, and a timer republishes at the next expiry
 * so a label FADES on its own — a plugin that dies leaves a row that cleans
 * itself up instead of a screen of stale state. Persisting tokens would
 * defeat that exactly: a daemon restart would restore labels whose author is
 * gone. (This is what the reference implementation does, and why.)
 *
 * ## What a plugin may say, and what it may not
 *
 * A plugin owns its OWN label, nothing else. The derived group, the activity
 * badge, the PR chip, the title and the branch are host-owned and are not
 * addressable here — a plugin that could overwrite "waiting on you" could
 * make the row lie about whether a human is blocked. `tone` names a ROLE
 * (`info`/`success`/`warning`/`error`/`muted`), never a colour, so the
 * active theme still decides what it looks like.
 *
 * `source` is the writing plugin's id, carried for attribution and for
 * per-source quotas. It is informational: a plugin already runs arbitrary
 * code as the user, so the store does not pretend to authenticate it.
 */

import type { DaemonEventBus } from "./event-bus.ts"

/** Semantic role, resolved to a colour by whatever theme is active. */
export const ROW_TOKEN_TONES = ["info", "success", "warning", "error", "muted"] as const
export type RowTokenTone = (typeof ROW_TOKEN_TONES)[number]

export function isRowTokenTone(value: unknown): value is RowTokenTone {
  return typeof value === "string" && (ROW_TOKEN_TONES as readonly string[]).includes(value)
}

/** One label on one task row. */
export interface RowToken {
  /** Writing plugin's id (or `"cli"` for a plain shell). Attribution only. */
  readonly source: string
  /** Per-source slot. A second write to the same key REPLACES the token —
   *  which is how a plugin refreshes a label's TTL without stacking copies. */
  readonly key: string
  readonly text: string
  readonly tone?: RowTokenTone
  /** Epoch ms. Past this the token is gone, written or not. */
  readonly expiresAt: number
}

/** Longest label a row will carry. A row has ~2 lines of budget shared with
 *  the title and branch; past this a token stops being a label and starts
 *  being the row. */
export const ROW_TOKEN_MAX_TEXT = 24
/** Slots per plugin per task. One plugin cannot fill the row with its own
 *  labels; how many plugins are installed is the user's own decision. */
export const ROW_TOKEN_MAX_PER_SOURCE = 2
/** TTL bounds. The floor keeps a token on screen long enough to be read; the
 *  ceiling means "forever" is not expressible, which is the whole contract. */
export const ROW_TOKEN_MIN_TTL_MS = 1_000
export const ROW_TOKEN_MAX_TTL_MS = 3_600_000
export const ROW_TOKEN_DEFAULT_TTL_MS = 60_000

export function clampRowTokenTtl(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms)) return ROW_TOKEN_DEFAULT_TTL_MS
  return Math.min(ROW_TOKEN_MAX_TTL_MS, Math.max(ROW_TOKEN_MIN_TTL_MS, Math.floor(ms)))
}

/** Trim to {@link ROW_TOKEN_MAX_TEXT}, collapsing the whitespace a multi-line
 *  label would otherwise smuggle into a single row. */
export function normalizeRowTokenText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, ROW_TOKEN_MAX_TEXT)
}

export interface RowTokenWrite {
  readonly taskId: string
  readonly source: string
  readonly key: string
  readonly text: string
  readonly tone?: RowTokenTone
  readonly ttlMs?: number
}

/** taskId → the tokens currently on that row. */
export type RowTokenMap = Readonly<Record<string, readonly RowToken[]>>

/**
 * In-memory row-token store. Publishes the FULL map on every change (the
 * `worktree.changes` shape), so a late subscriber's replay is the whole
 * truth and a reconnect needs no reconciliation.
 */
export class RowTokenStore {
  private readonly byTask = new Map<string, RowToken[]>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly bus: Pick<DaemonEventBus, "publish">,
    private readonly now: () => number = Date.now,
  ) {}

  /** Write (or refresh) one token. Returns the token as stored. */
  set(write: RowTokenWrite): RowToken {
    const token: RowToken = {
      source: write.source,
      key: write.key,
      text: normalizeRowTokenText(write.text),
      ...(write.tone ? { tone: write.tone } : {}),
      expiresAt: this.now() + clampRowTokenTtl(write.ttlMs),
    }
    const live = this.liveTokens(write.taskId).filter((t) => !(t.source === token.source && t.key === token.key))
    live.push(token)
    // Per-source quota, oldest-expiring first out: the slot a plugin is
    // actively refreshing is the one with the furthest deadline, so this
    // evicts the label it has stopped maintaining.
    const mine = live.filter((t) => t.source === token.source).sort((a, b) => a.expiresAt - b.expiresAt)
    const evict = new Set(mine.slice(0, Math.max(0, mine.length - ROW_TOKEN_MAX_PER_SOURCE)))
    this.store(
      write.taskId,
      live.filter((t) => !evict.has(t)),
    )
    return token
  }

  /** Drop one token early. `key` omitted clears every token from `source`. */
  clear(taskId: string, source: string, key?: string): boolean {
    const before = this.liveTokens(taskId)
    const after = before.filter((t) => t.source !== source || (key !== undefined && t.key !== key))
    this.store(taskId, after)
    return after.length !== before.length
  }

  /** Every token of a task whose record is gone. */
  clearTask(taskId: string): void {
    if (!this.byTask.delete(taskId)) return
    this.publish()
  }

  /** The full live map, expired tokens already dropped. */
  snapshot(): RowTokenMap {
    const out: Record<string, readonly RowToken[]> = {}
    for (const taskId of [...this.byTask.keys()]) {
      const live = this.liveTokens(taskId)
      if (live.length > 0) out[taskId] = live
      else this.byTask.delete(taskId)
    }
    return out
  }

  /** Stop the expiry timer (daemon shutdown). */
  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private liveTokens(taskId: string): RowToken[] {
    const at = this.now()
    return (this.byTask.get(taskId) ?? []).filter((t) => t.expiresAt > at)
  }

  private store(taskId: string, tokens: readonly RowToken[]): void {
    if (tokens.length > 0) this.byTask.set(taskId, [...tokens])
    else this.byTask.delete(taskId)
    this.publish()
  }

  /**
   * Publish the map and arm one timer at the nearest expiry. Without the
   * timer a token would stay on screen until somebody wrote again — an
   * abandoned label lingering forever is exactly the failure the TTL exists
   * to prevent, and no UI redraws on its own schedule.
   */
  private publish(): void {
    const tokens = this.snapshot()
    this.bus.publish("task.tokens", { tokens })
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    let next = Number.POSITIVE_INFINITY
    for (const list of Object.values(tokens)) for (const token of list) next = Math.min(next, token.expiresAt)
    if (!Number.isFinite(next)) return
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        this.publish()
      },
      Math.max(1, next - this.now()),
    )
    this.timer.unref?.()
  }
}
