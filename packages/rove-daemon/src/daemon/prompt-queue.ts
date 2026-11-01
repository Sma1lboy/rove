/**
 * Prompts held for a busy engine tab (`rove api send --queue`): pasted one at a time, each when the tab's
 * turn ends, so a follow-up never lands mid-turn. Codex drops the work in flight when a prompt is pasted
 * into a running turn, and Claude Code folds it into the running turn; this is the "after this turn" lane.
 *
 * In memory only: a daemon restart empties it (docs/API.md says so). A tab whose engine is waiting on a
 * permission menu, rate-limited, failed or dead keeps its items; only a working turn that ends hands one
 * over, and the paste re-checks the tab first (`heldBack`).
 */

import type { TaskActivityState } from "./attention-contracts.ts"
import type { DaemonEventBus } from "./event-bus.ts"

export interface QueuedPrompt {
  readonly id: string
  readonly taskId: string
  readonly tabId: string
  readonly text: string
  readonly expectReport: boolean
  readonly at: number
  /** Why the last hand-over did not land; the item stays at the head until it does or is cancelled. */
  readonly lastError?: string
}

export type QueueAddResult =
  | { readonly queued: false }
  | { readonly queued: true; readonly item: QueuedPrompt; readonly position: number }

/** Pastes one item; resolves to an error string when nothing landed, null when it did. */
export type QueueDeliver = (item: QueuedPrompt) => Promise<string | null>

/** A prompt pasted in one of these would land inside a turn or a menu. */
const BUSY: ReadonlySet<TaskActivityState> = new Set(["running", "permission_needed", "rate_limited"])
/** The turn is over: the engine is back at its own prompt. */
const DONE: ReadonlySet<TaskActivityState> = new Set(["turn_complete", "idle"])

const keyOf = (taskId: string, tabId: string): string => `${taskId}::${tabId}`
/** Between a turn's end and a paste: long enough for a menu event that trails the Stop to land. */
export const SETTLE_MS = 1500

/** What the queue last saw a tab do. `unconfirmed`: it came to rest straight from a menu, never through a running turn. */
interface TabReading {
  readonly state: TaskActivityState
  readonly at: number
  readonly unconfirmed: boolean
}

export class PromptQueue {
  private items: QueuedPrompt[] = []
  private readonly last = new Map<string, TabReading>()
  private readonly handing = new Set<string>()
  private seq = 1
  private readonly off: () => void

  constructor(
    bus: Pick<DaemonEventBus, "onPublish">,
    private readonly stateOf: (taskId: string, tabId: string) => TaskActivityState | undefined,
    private readonly deliver: QueueDeliver,
    private readonly now: () => number = Date.now,
    /** Between a turn's end and the paste: long enough for a hook that trails the Stop to land. */
    private readonly settle: () => Promise<void> = () => Bun.sleep(SETTLE_MS),
  ) {
    this.off = bus.onPublish((event) => {
      if (event.channel !== "engine-state") return
      const p = event.payload as { taskId?: unknown; tabId?: unknown; state?: unknown }
      // The task rollup (no tabId) says nothing about which tab's turn ended.
      if (typeof p.taskId === "string" && typeof p.tabId === "string" && typeof p.state === "string")
        this.observe(p.taskId, p.tabId, p.state as TaskActivityState)
    })
  }

  /**
   * Hold `text` for the tab, or say it can go now: the tab is not busy and nothing is ahead of it. A tab
   * the daemon has no reading for is not busy (a fresh engine, or one that never ran a turn).
   */
  add(input: { taskId: string; tabId: string; text: string; expectReport?: boolean }): QueueAddResult {
    const ahead = this.forTab(input.taskId, input.tabId).length
    const state = this.stateOf(input.taskId, input.tabId)
    if (ahead === 0 && (state === undefined || !BUSY.has(state))) return { queued: false }
    const item: QueuedPrompt = {
      id: `q-${this.seq++}`,
      taskId: input.taskId,
      tabId: input.tabId,
      text: input.text,
      expectReport: input.expectReport === true,
      at: this.now(),
    }
    this.items = [...this.items, item]
    if (state !== undefined) {
      const key = keyOf(input.taskId, input.tabId)
      if (this.last.get(key)?.state !== state) this.last.set(key, { state, at: this.now(), unconfirmed: false })
    }
    return { queued: true, item, position: ahead + 1 }
  }

  /** Oldest first; one task's when `taskId` is given. */
  list(taskId?: string): readonly QueuedPrompt[] {
    return taskId ? this.items.filter((i) => i.taskId === taskId) : this.items
  }

  cancel(id: string): boolean {
    const before = this.items.length
    this.items = this.items.filter((i) => i.id !== id)
    return this.items.length < before
  }

  /**
   * The tab's last rest came straight from a menu, never through a running turn: a stray Stop, the menu
   * possibly still drawn (a real approval reports `running` before its Stop). A client answering the menu
   * with keys (`answeredAt`, after the rest) closes it. False for a tab the queue never saw.
   */
  restUnconfirmed(taskId: string, tabId: string, answeredAt?: number): boolean {
    const reading = this.last.get(keyOf(taskId, tabId))
    if (!reading || !DONE.has(reading.state) || !reading.unconfirmed) return false
    return answeredAt === undefined || answeredAt < reading.at
  }

  /** Ms until a menu event trailing the tab's turn end would have landed; 0 unless it only just came to rest. */
  settleLeft(taskId: string, tabId: string): number {
    const reading = this.last.get(keyOf(taskId, tabId))
    if (!reading || !DONE.has(reading.state)) return 0
    return Math.max(0, SETTLE_MS - (this.now() - reading.at))
  }

  /** Tab ids of `taskId` the queue has a reading for. */
  tabsOf(taskId: string): string[] {
    const prefix = `${taskId}::`
    return [...this.last.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
  }

  close(): void {
    this.off()
  }

  private forTab(taskId: string, tabId: string): QueuedPrompt[] {
    return this.items.filter((i) => i.taskId === taskId && i.tabId === tabId)
  }

  private observe(taskId: string, tabId: string, state: TaskActivityState): void {
    const key = keyOf(taskId, tabId)
    const prev = this.last.get(key)
    // A rest is unconfirmed when it follows a menu directly, and stays so across further rest states.
    const unconfirmed =
      DONE.has(state) &&
      (prev?.state === "permission_needed" || (prev !== undefined && DONE.has(prev.state) && prev.unconfirmed))
    this.last.set(key, { state, at: this.now(), unconfirmed })
    // Only a turn seen working and then ending hands one over (the paste starts the next turn, whose end
    // hands the next). Straight from a menu to an end is a stray Stop with the menu still drawn: a real
    // approval reports `running` before its Stop. A held-back head waits for that same edge.
    if (prev?.state === "running" && DONE.has(state)) void this.handOver(taskId, tabId)
  }

  private async handOver(taskId: string, tabId: string): Promise<void> {
    const key = keyOf(taskId, tabId)
    if (!this.forTab(taskId, tabId)[0] || this.handing.has(key)) return
    this.handing.add(key)
    try {
      // A menu event that trails the turn's end must be seen before the paste: `deliver` re-checks the tab.
      await this.settle()
      const head = this.forTab(taskId, tabId)[0]
      if (!head) return
      const error = await this.deliver(head).catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
      if (error === null) this.items = this.items.filter((i) => i.id !== head.id)
      else this.items = this.items.map((i) => (i.id === head.id ? { ...i, lastError: error } : i))
    } finally {
      this.handing.delete(key)
    }
  }
}
