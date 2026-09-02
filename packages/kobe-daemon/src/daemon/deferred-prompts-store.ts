/**
 * Durable deferred-prompt store (issue #78 B-layer).
 *
 * When the delivery gate (A: recent human keystrokes / C: composer non-empty)
 * blocks a prompt, the prompt is NOT dropped and NOT hard-rejected — ownership
 * transfers to the daemon, which stores the text here and surfaces a
 * `prompt_deferred` inbox episode. A human later releases it from the Inbox
 * (the episode points here by id); the prompt text never lives in the inbox
 * episode (EngineActivityDetail describes engine activity, not prompts).
 *
 * Shape follows notes-store.ts: one JSON file, atomic tmp+rename, `version: 1`.
 * Retention is explicit and logged — a record never vanishes silently:
 * - at most ONE deferred prompt per (taskId, tabId) — the first writer keeps
 *   the slot until release, and a later writer gets an explicit rejection;
 * - records older than {@link DEFERRED_PROMPT_TTL_MS} are evicted during a
 *   successful file operation (also logged).
 */

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveEnv } from "../compat-env.ts"
import { logDaemonInfo } from "./crash-log.ts"

/** One deferred prompt per tab is kept until release or expiry. */
export const DEFERRED_PROMPT_TTL_MS = 24 * 60 * 60 * 1000

export type DeferredPromptLayer = "recent-human-write" | "composer-not-empty"

export type DeferredPromptDiscardReason = "Inbox item dismissed" | "Inbox item read by legacy client" | "tab closed"

/** One daemon-owned deferred prompt, awaiting a human's release from the Inbox. */
export interface DeferredPromptRecord {
  /** Stable id — the inbox episode references the record by this. */
  readonly id: string
  readonly taskId: string
  readonly tabId: string
  /** The prompt text, verbatim — the daemon owns it until release or expiry. */
  readonly prompt: string
  /** Which delivery-gate layer blocked the paste. */
  readonly layer: DeferredPromptLayer
  /** Sender provenance (peer dispatch carries a label + task id). */
  readonly senderLabel?: string
  readonly senderTaskId?: string
  /** Epoch ms of deferral. */
  readonly at: number
}

/** A tab already has daemon-owned text, so a later prompt was not accepted. */
export class DeferredPromptPendingError extends Error {
  constructor(readonly existing: DeferredPromptRecord) {
    super(`task ${existing.taskId} tab ${existing.tabId} already has a deferred prompt (${existing.id})`)
    this.name = "DeferredPromptPendingError"
  }
}

interface DeferredPromptsFile {
  version: 1
  records: DeferredPromptRecord[]
}

export function defaultDeferredPromptsPath(homeDir = readRoveEnv("HOME_DIR") ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "deferred-prompts.json")
}

function normalizeRecord(value: unknown): DeferredPromptRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== "string" || raw.id.length === 0) return null
  if (typeof raw.taskId !== "string" || raw.taskId.length === 0) return null
  if (typeof raw.tabId !== "string" || raw.tabId.length === 0) return null
  if (typeof raw.prompt !== "string" || raw.prompt.length === 0) return null
  if (raw.layer !== "recent-human-write" && raw.layer !== "composer-not-empty") return null
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null
  return {
    id: raw.id,
    taskId: raw.taskId,
    tabId: raw.tabId,
    prompt: raw.prompt,
    layer: raw.layer,
    ...(typeof raw.senderLabel === "string" ? { senderLabel: raw.senderLabel } : {}),
    ...(typeof raw.senderTaskId === "string" ? { senderTaskId: raw.senderTaskId } : {}),
    at: raw.at,
  }
}

async function readStore(path: string): Promise<DeferredPromptsFile> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DeferredPromptsFile>
    if (!Array.isArray(parsed.records)) return { version: 1, records: [] }
    return {
      version: 1,
      records: parsed.records.map(normalizeRecord).filter((r): r is DeferredPromptRecord => r !== null),
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, records: [] }
    throw err
  }
}

async function writeStore(path: string, records: readonly DeferredPromptRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`
  const body: DeferredPromptsFile = { version: 1, records: [...records] }
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8")
  await rename(tmp, path)
}

const SUBSYSTEM = "deferred-prompts"

export class DeferredPromptsStore {
  private readonly tail: Promise<void> = Promise.resolve()
  private queue: Promise<void> = this.tail

  constructor(
    private readonly path = defaultDeferredPromptsPath(),
    private readonly now = () => Date.now(),
  ) {}

  /** Serialize read-modify-write on the shared file (same unit as the inbox store). */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * Store one deferred prompt when its (taskId, tabId) slot is vacant, while
   * evicting TTL-expired records when the new prompt is accepted. A live
   * record wins over later writers, so a prompt the daemon already accepted
   * cannot disappear under a second send.
   * Returns the stored record (with its minted id).
   */
  async file(record: Omit<DeferredPromptRecord, "id">): Promise<DeferredPromptRecord> {
    return await this.enqueue(async () => {
      const now = this.now()
      const store = await readStore(this.path)
      const kept: DeferredPromptRecord[] = []
      let occupied: DeferredPromptRecord | null = null
      for (const existing of store.records) {
        if (now - existing.at > DEFERRED_PROMPT_TTL_MS) {
          logDaemonInfo(
            SUBSYSTEM,
            `expired deferred prompt ${existing.id} for ${existing.taskId}::${existing.tabId} (age ${Math.round((now - existing.at) / 1000)}s) — dropped`,
          )
          continue
        }
        if (existing.taskId === record.taskId && existing.tabId === record.tabId) {
          occupied = existing
        }
        kept.push(existing)
      }
      if (occupied) throw new DeferredPromptPendingError(occupied)
      const next: DeferredPromptRecord = { ...record, id: randomUUID() }
      kept.push(next)
      await writeStore(this.path, kept)
      return next
    })
  }

  /** Fetch one record by id, or null when absent after release or later expiry cleanup. */
  async get(id: string): Promise<DeferredPromptRecord | null> {
    return await this.enqueue(async () => (await readStore(this.path)).records.find((r) => r.id === id) ?? null)
  }

  /**
   * List every live record in insertion order. A flush is also a successful
   * store operation, so it enforces the same TTL boundary as filing a prompt.
   */
  async list(): Promise<readonly DeferredPromptRecord[]> {
    return await this.enqueue(async () => {
      const now = this.now()
      const store = await readStore(this.path)
      const kept = store.records.filter((record) => {
        if (now - record.at <= DEFERRED_PROMPT_TTL_MS) return true
        logDaemonInfo(
          SUBSYSTEM,
          `expired deferred prompt ${record.id} for ${record.taskId}::${record.tabId} (age ${Math.round((now - record.at) / 1000)}s) — dropped`,
        )
        return false
      })
      if (kept.length !== store.records.length) await writeStore(this.path, kept)
      return kept
    })
  }

  /** Remove one record (called after its prompt was inserted, or on dismiss). */
  async resolve(id: string): Promise<boolean> {
    return await this.enqueue(async () => {
      const store = await readStore(this.path)
      const kept = store.records.filter((r) => r.id !== id)
      if (kept.length === store.records.length) return false
      await writeStore(this.path, kept)
      return true
    })
  }

  /** Drop a tab's prompt after an explicit user/UI lifecycle action, with a log. */
  async discardTab(
    taskId: string,
    tabId: string,
    reason: DeferredPromptDiscardReason,
  ): Promise<readonly DeferredPromptRecord[]> {
    return await this.enqueue(async () => {
      const store = await readStore(this.path)
      const dropped = store.records.filter((record) => record.taskId === taskId && record.tabId === tabId)
      if (dropped.length === 0) return []
      for (const record of dropped) {
        logDaemonInfo(SUBSYSTEM, `dropped deferred prompt ${record.id} for ${taskId}::${tabId} — ${reason}`)
      }
      await writeStore(
        this.path,
        store.records.filter((record) => record.taskId !== taskId || record.tabId !== tabId),
      )
      return dropped
    })
  }

  /** All records for a task (the exit path lists what is queued for a tab). */
  async listForTask(taskId: string): Promise<readonly DeferredPromptRecord[]> {
    return await this.enqueue(async () => (await readStore(this.path)).records.filter((r) => r.taskId === taskId))
  }

  /** Task deletion drops its queued prompts — logged, never silent. */
  async deleteTask(taskId: string): Promise<void> {
    await this.enqueue(async () => {
      const store = await readStore(this.path)
      const kept = store.records.filter((r) => r.taskId !== taskId)
      if (kept.length === store.records.length) return
      for (const dropped of store.records) {
        if (dropped.taskId === taskId) {
          logDaemonInfo(SUBSYSTEM, `dropped deferred prompt ${dropped.id} — task ${taskId} deleted`)
        }
      }
      await writeStore(this.path, kept)
    })
  }
}
