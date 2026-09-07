/**
 * Durable, daemon-owned attention Inbox.
 *
 * Live engine activity and Inbox retention are deliberately different state:
 * activity may idle on session close or task deletion, while the durable queue survives
 * daemon restarts. An item leaves when its target is visited/opened, the user
 * removes it, that Task and Terminal Tab start another turn, or the containing
 * Task is hard-deleted. A newer attention event for the same target replaces
 * the older item at the end of the queue.
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
 * Retention cap (prune-oldest, shape of `pty-exit-store.ts`'s MAX_RECORDS):
 * an episode leaves only on visit / dismiss / a newer turn on the same
 * task+tab / task hard-delete — a task you never revisit keeps its episode
 * forever, and every recorded episode rewrites the whole file. Without a
 * cap the queue grows without bound; the size of a real install's task list
 * is the natural ceiling on live episodes, but forgotten tasks must not
 * accumulate tax forever.
 */
export const MAX_EPISODES = 500

export type AttentionInboxLane = "activity" | "prompt_deferred"

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
    // All retained episodes are pending. The field is written for snapshot
    // compatibility; the queue model does not read it.
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
    // Nothing CAN be there: no file (ENOENT), or a path component that is not
    // a directory (ENOTDIR — broken config, and the write will fail too).
    if (code === "ENOENT" || code === "ENOTDIR") return []
    // An I/O failure is not an empty queue. Returning `[]` published an
    // authoritative "nothing needs you" AND made memory the source of truth,
    // so the next `commit()` rewrote the whole file from an empty map — one
    // transient EACCES/EMFILE/EIO permanently destroyed the queue. Re-throw,
    // the shape `deferred-prompts-store.ts` already uses; only errors that
    // carry an errno are I/O. A `SyntaxError` from genuinely malformed JSON
    // has none and still reads as empty, which is the recorded decision.
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
  /** False until one read of the file SUCCEEDED. Every write rewrites the
   *  document whole, so committing before that would publish an empty map as
   *  the new truth — see the guard in {@link commit}. */
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
   * `tabId` is nullable: an engine the user typed into a shell that kobe did
   * not spawn — including the shell an exited engine leaves behind in place —
   * inherits no `KOBE_TAB_ID`, so its hooks report task-only. Dropping those
   * events would keep such a session out of the Inbox entirely. A task-level
   * episode still navigates (the task's active tab); the tab-level one is
   * simply more precise when the identity is there.
   */
  async record(
    taskId: string,
    kind: EngineActivityKind,
    detail: EngineActivityDetail | undefined,
    tabIdInput: string | null,
  ): Promise<void> {
    // An empty string is not a tab — normalize it to the task level rather
    // than minting an episode keyed on `""`.
    const tabId = tabIdInput === null || tabIdInput.length === 0 ? null : tabIdInput
    await this.enqueue(async () => {
      const key = attentionInboxItemKey({ taskId, tabId })
      const next = new Map(this.items)
      if (kind === "turn-start") {
        if (!next.delete(key)) return
      } else {
        const state = stateFor(kind, detail)
        if (!state) return
        // Dedupe rule: one pending episode per task+tab —
        // a fresh event REPLACES the stale one and takes the latest position
        // (delete-then-set so the fresh `at` re-sorts it to the queue tail).
        next.delete(key)
        next.set(key, {
          taskId,
          tabId,
          state,
          ...(detail ? { detail } : {}),
          // Every stored episode is pending by definition (opening removes
          // it). Kept on the wire for old-client compatibility only.
          unread: true,
          at: this.now(),
        })
      }
      await this.commit(next)
    })
  }

  /**
   * Record a `dead` episode: the tab's engine PROCESS is gone, from the
   * pty-host's exit record (pty-exit-watch.ts). Its own path rather than a
   * `record()` kind, for the same reason `recordPromptDeferred` has one —
   * there is no hook event behind it, so it has no {@link EngineActivityKind}.
   *
   * Every OTHER episode is something the engine reported about itself, so a
   * KILLED engine (no Stop, no SessionEnd, no hook at all) has nothing to
   * report — without this path the one surface whose job is "what needs me"
   * stays silent about every dead agent.
   *
   * Deduped per task+tab like every other episode: a fresh death replaces the
   * previous episode for that tab and takes the queue tail.
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

  /**
   * Record a `prompt_deferred` episode: a prompt the
   * delivery gate blocked was accepted into the DeferredPromptsStore, and the
   * episode points at that record by id (the prompt text is NOT copied here —
   * `EngineActivityDetail` describes engine activity). One pending episode per
   * task+tab, so a fresh deferral replaces the previous episode for the tab.
   */
  async recordPromptDeferred(
    taskId: string,
    tabId: string,
    deferredId: string,
    layer: "recent-human-write" | "composer-not-empty",
    expiresAt?: number,
    sender?: string,
  ): Promise<void> {
    await this.enqueue(async () => {
      const key = attentionInboxItemKey({ taskId, tabId, state: "prompt_deferred" })
      const next = new Map(this.items)
      next.delete(key)
      next.set(key, {
        taskId,
        tabId,
        state: "prompt_deferred",
        detail: {
          deferredPrompt: {
            id: deferredId,
            layer,
            ...(expiresAt === undefined ? {} : { expiresAt }),
            ...(sender === undefined ? {} : { sender }),
          },
        },
        unread: true,
        at: this.now(),
      })
      await this.commit(next)
    })
  }

  /**
   * Replace a `prompt_deferred` episode with the notice that its text was
   * destroyed undelivered.
   *
   * The expiry sweep used to just delete the row. `rove api send` had already
   * exited 0 calling the deferral a success and the sender's session was long
   * gone, so a silent delete meant NOBODY ever learned the message did not
   * run. Same key as the episode it replaces (`prompt_expired` shares the
   * deferred lane), so this is an in-place swap and the user still dismisses
   * it the way they dismiss anything else.
   */
  async recordPromptExpired(taskId: string, tabId: string, deferredId: string, at: number): Promise<void> {
    await this.enqueue(async () => {
      const key = attentionInboxItemKey({ taskId, tabId, state: "prompt_expired" })
      const previous = this.items.get(key)
      const next = new Map(this.items)
      next.delete(key)
      next.set(key, {
        taskId,
        tabId,
        state: "prompt_expired",
        // The layer is carried over so the row still says which gate held the
        // text; the id keeps the episode addressable by the same RPCs.
        detail: {
          deferredPrompt: {
            id: deferredId,
            layer: previous?.detail?.deferredPrompt?.layer ?? "composer-not-empty",
            expiresAt: at,
            ...(previous?.detail?.deferredPrompt?.sender === undefined
              ? {}
              : { sender: previous.detail.deferredPrompt.sender }),
          },
        },
        unread: true,
        at,
      })
      await this.commit(next)
    })
  }

  /**
   * Legacy RPC (pre queue-drain model): opening now DELETES the episode
   * (`deleteEpisode` via attention.dismiss). Kept for old clients whose
   * open still calls attention.markRead — treat it as the same resolve.
   */
  async markRead(
    taskId: string,
    tabId: string | null,
    at: number,
    lane?: AttentionInboxLane,
    deferredId?: string,
  ): Promise<boolean> {
    return await this.deleteEpisode(taskId, tabId, at, lane, deferredId)
  }

  /** Delete a matching episode; lane and deferredId narrow cross-store cleanup. */
  async deleteEpisode(
    taskId: string,
    tabId: string | null,
    at?: number,
    lane?: AttentionInboxLane,
    deferredId?: string,
  ): Promise<boolean> {
    return await this.enqueue(async () => {
      const activityKey = attentionInboxItemKey({ taskId, tabId })
      const deferredKey = attentionInboxItemKey({ taskId, tabId, state: "prompt_deferred" })
      const keys =
        lane === "activity" ? [activityKey] : lane === "prompt_deferred" ? [deferredKey] : [activityKey, deferredKey]
      const next = new Map(this.items)
      let removed = false
      for (const key of keys) {
        const item = this.items.get(key)
        if (!item || (at !== undefined && item.at !== at)) continue
        if (deferredId !== undefined && item.detail?.deferredPrompt?.id !== deferredId) continue
        next.delete(key)
        removed = true
      }
      if (!removed) return false
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
   * Record (or refresh) the `routine_failed` episode for one routine.
   *
   * Its own path for the same reason `recordEngineDeath` has one: no engine
   * reported anything. A schedule fired with nobody watching and could not do
   * its work, and every other surface that would have shown it — the sidebar
   * badge, the tab strip, a toast — is keyed on a task this firing may never
   * have created.
   *
   * Deduped on the ROUTINE, not the task: a fresh-task routine mints a task
   * per firing, so a schedule failing every minute produces ONE episode that
   * keeps being replaced with the latest reason, not 1,440 a day.
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

  /** Drop a deleted routine's episode — nothing else would ever clear it, and
   *  the queue is supposed to describe things that still exist. */
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

  /** Serialize mutations so concurrent hook/RPC writes cannot clobber the file. */
  private async commit(next: ReadonlyMap<string, AttentionInboxItem>): Promise<void> {
    // Never write a file we could not read. `init()` leaves this false when
    // the load threw (its caller logs and carries on), and every commit
    // rewrites the document whole — so writing here would turn a recoverable
    // read blip into the permanent deletion of every pending episode.
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
