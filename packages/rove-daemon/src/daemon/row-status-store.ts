/**
 * The daemon's row-status store: what every client's rail shows for each task
 * and tab, computed once from what the daemon already owns, and published on
 * `row.status`. Inputs, all daemon-side:
 *
 * - the activity ledger (`engine-state`, per tab and per task);
 * - the attention inbox (`attention.inbox`): an episode is a result nobody
 *   opened, so "unseen" is the inbox's to say, not a client's local memory;
 * - the PTY host's session list, polled here: alive, freeze-restored;
 * - task jobs (`task.jobs`) and deletion (`task.snapshot`);
 * - who is looking at which tab (`ui.viewing`, per connection): a tab being
 *   watched never shows unseen, and opening it clears its inbox episode;
 * - answers (`activity.answered`): a question just answered stops showing `?`
 *   until the engine reports again.
 *
 * Clients send those two reports and render; none decides a status itself.
 */

import type { AttentionInboxItem, TaskActivityState } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import type { SerializedTask } from "./protocol.ts"
import { aliasKey } from "./pty-alias.ts"
import { type RowStatus, type TabStatus, type TaskStatus, sameTaskStatus, tabStatus, taskStatus } from "./row-status.ts"

export interface RowStatusPayload {
  readonly tasks: Readonly<Record<string, TaskStatus>>
  /** Rises on every change; a client keeps the newest. */
  readonly rev: number
}

export interface StatusSession {
  readonly key: string
  readonly alive: boolean
  readonly restored?: boolean
}

export interface RowStatusDeps {
  readonly bus: Pick<DaemonEventBus, "publish" | "onPublish" | "snapshot">
  /** The PTY host's sessions; null when it did not answer (keep the last list). */
  readonly listSessions: () => Promise<readonly StatusSession[] | null>
  /** Clear an inbox episode a client is looking at. */
  readonly readEpisode: (taskId: string, tabId: string | null, at: number) => Promise<unknown>
  /** True while some full client (a TUI, the bridge) is attached: poll the host faster. */
  readonly anyGui: () => boolean
  /** The task's tab ids as the tab store holds them; null when it has no record. A closed tab drops out. */
  readonly tabIdsOf?: (taskId: string) => readonly string[] | null
  /** Every successful session listing, for owners that follow PTY lifetimes (migrated children's aliases). */
  readonly onSessions?: (sessions: readonly StatusSession[]) => void
  readonly now?: () => number
}

const POLL_ATTACHED_MS = 2_000
const POLL_IDLE_MS = 10_000
const PUBLISH_DEBOUNCE_MS = 40

const tabKey = (taskId: string, tabId: string) => `${taskId}::${tabId}`

export class RowStatusStore {
  private readonly tabActivity = new Map<string, { state: TaskActivityState; at: number }>()
  private readonly taskActivity = new Map<string, { state: TaskActivityState; at: number }>()
  private inbox: readonly AttentionInboxItem[] = []
  private tasks: readonly SerializedTask[] = []
  private readonly jobs = new Map<string, number>()
  private sessions = new Map<string, { alive: boolean; restored: boolean }>()
  /** `${clientId}:${viewer}` → the tab that viewer has open. */
  private readonly viewing = new Map<string, { taskId: string; tabId: string | null }>()
  private readonly answered = new Map<string, number>()
  private status: Record<string, TaskStatus> = {}
  private rev = 0
  private publishTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private readonly off: () => void
  private readonly now: () => number
  private closed = false

  constructor(private readonly deps: RowStatusDeps) {
    this.now = deps.now ?? Date.now
    for (const event of deps.bus.snapshot()) this.take(event.channel, event.payload)
    this.off = deps.bus.onPublish((event) => {
      if (this.take(event.channel, event.payload)) this.schedule()
    })
    this.schedule()
    void this.poll()
  }

  list(): RowStatusPayload {
    return { tasks: this.status, rev: this.rev }
  }

  /** A client (or one viewer behind it, e.g. a browser behind the bridge) now shows this tab; null = none. */
  setViewing(clientId: number, viewer: string, taskId: string | null, tabId: string | null): void {
    const key = `${clientId}:${viewer}`
    if (taskId === null) this.viewing.delete(key)
    else this.viewing.set(key, { taskId, tabId })
    this.readViewedEpisodes()
    this.schedule()
  }

  /** A connection left: whatever it was looking at is no longer looked at. */
  dropClient(clientId: number): void {
    let changed = false
    for (const key of [...this.viewing.keys()]) {
      if (key.startsWith(`${clientId}:`)) changed = this.viewing.delete(key) || changed
    }
    if (changed) this.schedule()
  }

  /** The user answered this tab's question; its `?` clears until the engine reports again. */
  setAnswered(taskId: string, tabId: string): void {
    this.answered.set(tabKey(taskId, tabId), this.now())
    this.schedule()
  }

  close(): void {
    this.closed = true
    this.off()
    if (this.publishTimer) clearTimeout(this.publishTimer)
    if (this.pollTimer) clearTimeout(this.pollTimer)
  }

  /** Fold one bus event in; true when it can change a status. */
  private take(channel: string, payload: unknown): boolean {
    if (channel === "engine-state") {
      const p = payload as { taskId?: string; tabId?: string; state?: TaskActivityState; at?: number }
      if (typeof p.taskId !== "string" || typeof p.state !== "string") return false
      const entry = { state: p.state, at: typeof p.at === "number" ? p.at : this.now() }
      if (typeof p.tabId === "string" && p.tabId) this.tabActivity.set(tabKey(p.taskId, p.tabId), entry)
      else this.taskActivity.set(p.taskId, entry)
      return true
    }
    if (channel === "attention.inbox") {
      this.inbox = (payload as { items?: AttentionInboxItem[] }).items ?? []
      this.readViewedEpisodes()
      return true
    }
    if (channel === "task.snapshot") {
      this.tasks = (payload as { tasks?: SerializedTask[] }).tasks ?? []
      return true
    }
    // A closed tab leaves the tab store: its row goes with it (`tabIdsOf`).
    if (channel === "tabs.changed") return true
    if (channel === "task.jobs") {
      const p = payload as { taskId?: string; phase?: string }
      if (typeof p.taskId !== "string") return false
      if (p.phase === "running") this.jobs.set(p.taskId, this.now())
      else this.jobs.delete(p.taskId)
      return true
    }
    return false
  }

  /** Opening a tab reads its result: the inbox episode goes, for every client. */
  private readViewedEpisodes(): void {
    for (const item of this.inbox) {
      if (item.taskId === null || !this.isViewed(item.taskId, item.tabId)) continue
      void this.deps
        .readEpisode(item.taskId, item.tabId, item.at)
        .catch((err) => logDaemonError("row-status-read", err))
    }
  }

  private isViewed(taskId: string, tabId: string | null): boolean {
    for (const v of this.viewing.values()) {
      if (v.taskId === taskId && (tabId === null || v.tabId === tabId)) return true
    }
    return false
  }

  private async poll(): Promise<void> {
    if (this.closed) return
    try {
      const list = await this.deps.listSessions()
      if (list) {
        this.deps.onSessions?.(list)
        const next = new Map(list.map((s) => [s.key, { alive: s.alive, restored: s.restored === true }]))
        if (JSON.stringify([...next]) !== JSON.stringify([...this.sessions])) {
          this.sessions = next
          this.schedule()
        }
      }
    } catch (err) {
      logDaemonError("row-status-poll", err)
    }
    if (this.closed) return
    this.pollTimer = setTimeout(() => void this.poll(), this.deps.anyGui() ? POLL_ATTACHED_MS : POLL_IDLE_MS)
    this.pollTimer.unref?.()
  }

  private schedule(): void {
    if (this.publishTimer || this.closed) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null
      this.recompute()
    }, PUBLISH_DEBOUNCE_MS)
    this.publishTimer.unref?.()
  }

  private recompute(): void {
    const pending = new Map<string, { state: string; at: number }>()
    for (const item of this.inbox) {
      if (item.taskId !== null) pending.set(`${item.taskId}::${item.tabId ?? ""}`, { state: item.state, at: item.at })
    }
    const next: Record<string, TaskStatus> = {}
    for (const task of this.tasks) {
      const alias = task.ptyAlias
      const tabIds = new Set<string>()
      for (const key of [...this.tabActivity.keys(), ...this.sessions.keys(), ...pending.keys()]) {
        if (key.startsWith(`${task.id}::`)) {
          const tabId = key.slice(task.id.length + 2).split("::")[0] ?? ""
          if (tabId) tabIds.add(tabId)
        }
      }
      // A migrated child's PTY is keyed under its parent, so its own tab finds the session there.
      const aliasSession = alias ? this.sessions.get(aliasKey(alias)) : undefined
      if (alias && aliasSession) tabIds.add(alias.tabId)
      // A tab the tab store no longer lists is closed: its ledger and inbox leftovers are not a row.
      const listed = this.deps.tabIdsOf?.(task.id)
      if (listed) for (const tabId of [...tabIds]) if (!listed.includes(tabId)) tabIds.delete(tabId)
      const tabs: Record<string, TabStatus> = {}
      for (const tabId of tabIds) {
        const key = tabKey(task.id, tabId)
        const activity = this.tabActivity.get(key)
        const session = this.sessions.get(key) ?? (alias?.tabId === tabId ? aliasSession : undefined)
        tabs[tabId] = tabStatus({
          ...(activity && activity.state !== "idle" ? { activity } : activity ? { activity } : {}),
          ...(pending.has(key) ? { pending: pending.get(key) } : {}),
          viewed: this.isViewed(task.id, tabId),
          ...(this.answered.has(key) ? { answeredAt: this.answered.get(key) } : {}),
          ...(session ? { session } : {}),
        })
      }
      const tablessActivity = this.taskActivity.get(task.id)
      const tablessPending = pending.get(`${task.id}::`)
      const tabless: RowStatus | undefined =
        tablessPending && !this.isViewed(task.id, null) && tablessPending.state === "turn_complete"
          ? { kind: "unseen", since: tablessPending.at }
          : tablessActivity
            ? tabStatus({ activity: tablessActivity, viewed: false })
            : undefined
      const deletion = task.deletion
      const job = this.jobs.get(task.id)
      const status: TaskStatus = {
        task: taskStatus(tabs, {
          ...(tabless ? { tabless } : {}),
          ...(job !== undefined ? { job: { at: job } } : {}),
          ...(deletion
            ? { deletion: { failed: deletion.phase === "error", at: Date.parse(deletion.requestedAt) || 0 } }
            : {}),
        }),
        tabs,
      }
      next[task.id] = sameTaskStatus(this.status[task.id], status) ? (this.status[task.id] as TaskStatus) : status
    }
    const changed =
      Object.keys(next).length !== Object.keys(this.status).length ||
      Object.entries(next).some(([id, s]) => this.status[id] !== s)
    if (!changed) return
    this.status = next
    this.rev += 1
    this.deps.bus.publish("row.status", { tasks: this.status, rev: this.rev })
  }
}
