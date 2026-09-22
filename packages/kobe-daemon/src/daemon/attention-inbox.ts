/**
 * Durable, daemon-owned attention Inbox; survives daemon restarts, unlike live
 * activity. An item leaves when its target is opened, the user removes it,
 * that Task+Tab starts another turn, or the Task is hard-deleted. A newer event
 * for the same target replaces the older item at the queue tail.
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import {
  type AttentionInboxItem,
  type AttentionInboxState,
  type EngineActivityDetail,
  type EngineActivityKind,
  attentionInboxItemKey,
  isAttentionInboxState,
} from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"

interface AttentionInboxFile {
  readonly version: 1
  readonly items: AttentionInboxItem[]
}

/**
 * Retention cap, prune-oldest: a never-revisited task keeps its episode
 * forever, and every record rewrites the whole file.
 */
export const MAX_EPISODES = 500

export function defaultAttentionInboxPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "attention-inbox.json")
}

function stateFor(kind: EngineActivityKind, detail?: EngineActivityDetail): AttentionInboxState | null {
  if (kind === "turn-complete") return "turn_complete"
  if (kind === "awaiting-input") return "permission_needed"
  if (kind !== "turn-failed") return null
  return detail?.failure === "rate_limit" ? "rate_limited" : "error"
}

function normalizeItem(value: unknown): AttentionInboxItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const item = value as Partial<AttentionInboxItem>
  // `null` is legal only for a routine episode, which has no task by nature.
  const taskless = item.taskId === null || item.taskId === undefined
  if (taskless ? item.state !== "routine_failed" : typeof item.taskId !== "string" || item.taskId.length === 0) {
    return null
  }
  if (item.tabId !== null && typeof item.tabId !== "string") return null
  if (!isAttentionInboxState(item.state)) return null
  if (typeof item.at !== "number" || !Number.isFinite(item.at)) return null
  return {
    taskId: taskless ? null : (item.taskId as string),
    tabId: item.tabId,
    state: item.state,
    ...(item.detail ? { detail: item.detail } : {}),
    // Written for snapshot compatibility only; the queue model never reads it.
    unread: item.unread !== false,
    at: item.at,
  }
}

async function readStore(path: string): Promise<AttentionInboxItem[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<AttentionInboxFile>
    if (!Array.isArray(parsed.items)) return []
    return parsed.items.map(normalizeItem).filter((item): item is AttentionInboxItem => item !== null)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // Nothing CAN be there (ENOTDIR: broken config; the write will fail too).
    if (code === "ENOENT" || code === "ENOTDIR") return []
    // An I/O failure is not an empty queue: `[]` would let the next commit()
    // rewrite the file empty, so one transient EACCES/EIO destroys the queue.
    // Malformed JSON (no errno) still reads as empty, by decision.
    if (code !== undefined) throw err
    logDaemonError("attention-inbox-load", err)
    return []
  }
}

async function writeStore(path: string, items: readonly AttentionInboxItem[]): Promise<void> {
  const body: AttentionInboxFile = { version: 1, items: [...items] }
  await writeJsonAtomic(path, body)
}

export class AttentionInboxStore {
  private readonly items = new Map<string, AttentionInboxItem>()
  /** False until one read SUCCEEDED; {@link commit} refuses to write before that. */
  private loaded = false

  constructor(
    private readonly path: string,
    private readonly bus: DaemonEventBus,
    private readonly now = () => Date.now(),
  ) {}

  async init(): Promise<void> {
    await this.enqueue(async () => {
      const items = await readStore(this.path)
      this.items.clear()
      for (const item of items) this.items.set(attentionInboxItemKey(item), item)
      this.loaded = true
      this.publish()
    })
  }

  snapshot(): AttentionInboxItem[] {
    return [...this.items.values()].sort(compareItems)
  }

  /**
   * `tabId` is nullable: an engine started by hand in a shell (including the
   * one an exited engine leaves behind) has no `KOBE_TAB_ID`, so its hooks
   * report task-only. A task-level episode still navigates to the active tab.
   */
  async record(
    taskId: string,
    kind: EngineActivityKind,
    detail: EngineActivityDetail | undefined,
    tabIdInput: string | null,
  ): Promise<void> {
    // "" is not a tab; don't key an episode on it.
    const tabId = tabIdInput === null || tabIdInput.length === 0 ? null : tabIdInput
    await this.enqueue(async () => {
      const key = attentionInboxItemKey({ taskId, tabId })
      const next = new Map(this.items)
      if (kind === "turn-start") {
        if (!next.delete(key)) return
      } else {
        const state = stateFor(kind, detail)
        if (!state) return
        // One episode per task+tab; the fresh one takes the queue tail.
        next.delete(key)
        next.set(key, {
          taskId,
          tabId,
          state,
          ...(detail ? { detail } : {}),
          // Old-client wire compat only: stored episodes are always pending.
          unread: true,
          at: this.now(),
        })
      }
      await this.commit(next)
    })
  }

  /**
   * A `dead` episode from the pty-host's exit record (pty-exit-watch.ts). Not
   * a `record()` kind: a KILLED engine fires no hook, so it has no
   * {@link EngineActivityKind}. Deduped per task+tab like the rest.
   */
  async recordEngineDeath(taskId: string, tabId: string, detail: EngineActivityDetail, at: number): Promise<void> {
    await this.enqueue(async () => {
      const key = attentionInboxItemKey({ taskId, tabId })
      const next = new Map(this.items)
      next.delete(key)
      next.set(key, { taskId, tabId, state: "dead", detail, unread: true, at })
      await this.commit(next)
    })
  }

  /** Old clients' `attention.markRead`; resolves exactly like {@link deleteEpisode}. */
  async markRead(taskId: string, tabId: string | null, at: number): Promise<boolean> {
    return await this.deleteEpisode(taskId, tabId, at)
  }

  /** Delete the episode for a task+tab, optionally pinned to its event time. */
  async deleteEpisode(taskId: string, tabId: string | null, at?: number): Promise<boolean> {
    return await this.enqueue(async () => {
      const key = attentionInboxItemKey({ taskId, tabId })
      const item = this.items.get(key)
      if (!item || (at !== undefined && item.at !== at)) return false
      const next = new Map(this.items)
      next.delete(key)
      await this.commit(next)
      return true
    })
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.enqueue(async () => {
      const next = new Map(this.items)
      let changed = false
      for (const [key, item] of next) {
        if (item.taskId !== taskId) continue
        next.delete(key)
        changed = true
      }
      if (changed) await this.commit(next)
    })
  }

  /** Task deletion must continue even when Inbox persistence is unavailable. */
  async deleteTaskBestEffort(taskId: string): Promise<void> {
    await this.deleteTask(taskId).catch((err) => logDaemonError("attention-inbox-task-delete", err))
  }

  /**
   * Record (or refresh) a routine's `routine_failed` episode. No engine
   * reported it, and other surfaces are keyed on a task the firing may never
   * have created. Deduped on the ROUTINE: a fresh-task routine failing every
   * minute yields ONE episode, not 1,440 a day.
   */
  async recordRoutineFailure(
    routine: { automationId: string; name: string; status: string; error?: string },
    taskId: string | null,
    at: number,
  ): Promise<void> {
    await this.enqueue(async () => {
      const detail: EngineActivityDetail = { routine }
      const key = attentionInboxItemKey({ taskId, tabId: null, state: "routine_failed", detail })
      const next = new Map(this.items)
      next.delete(key)
      next.set(key, { taskId, tabId: null, state: "routine_failed", detail, unread: true, at })
      await this.commit(next)
    })
  }

  /** Drop a deleted routine's episode; nothing else would ever clear it. */
  async deleteRoutineEpisode(automationId: string): Promise<void> {
    await this.enqueue(async () => {
      const next = new Map(this.items)
      let changed = false
      for (const [key, item] of next) {
        if (item.detail?.routine?.automationId !== automationId) continue
        next.delete(key)
        changed = true
      }
      if (changed) await this.commit(next)
    })
  }

  /** Serialize mutations so concurrent hook/RPC writes cannot clobber the file. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return serialized(this.path, operation)
  }

  /** Rewrite the whole file, then publish. */
  private async commit(next: ReadonlyMap<string, AttentionInboxItem>): Promise<void> {
    // Never write a file we could not read: a failed load plus a whole-file
    // rewrite would permanently delete every pending episode.
    if (!this.loaded) throw new Error(`attention inbox never loaded (${this.path}) — refusing to overwrite it`)
    // Sorted ascending by `at`, so the tail is the newest — prune-oldest.
    const items = [...next.values()].sort(compareItems).slice(-MAX_EPISODES)
    await writeStore(this.path, items)
    this.items.clear()
    for (const item of items) this.items.set(attentionInboxItemKey(item), item)
    this.bus.publish("attention.inbox", { items })
  }

  private publish(): void {
    this.bus.publish("attention.inbox", { items: this.snapshot() })
  }
}

function compareItems(a: AttentionInboxItem, b: AttentionInboxItem): number {
  return a.at - b.at || (a.taskId ?? "").localeCompare(b.taskId ?? "") || (a.tabId ?? "").localeCompare(b.tabId ?? "")
}
