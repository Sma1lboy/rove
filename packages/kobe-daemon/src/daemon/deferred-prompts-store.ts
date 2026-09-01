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
 * - at most ONE deferred prompt per (taskId, tabId) — a newer deferral for a
 *   tab that already has one REPLACES it (the displaced text is logged);
 * - records older than {@link DEFERRED_PROMPT_TTL_MS} are evicted on write
 *   (also logged).
 */

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveEnv } from "../compat-env.ts"
import { logDaemonInfo } from "./crash-log.ts"

/** One deferred prompt per tab is kept; a newer deferral displaces the older. */
export const DEFERRED_PROMPT_TTL_MS = 24 * 60 * 60 * 1000

export type DeferredPromptLayer = "recent-human-write" | "composer-not-empty"

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
   * Store one deferred prompt, displacing any existing record for the same
   * (taskId, tabId) and evicting TTL-expired records. Both displacements and
   * expiries are logged — a deferred prompt never disappears silently.
   * Returns the stored record (with its minted id).
   */
  async file(record: Omit<DeferredPromptRecord, "id">): Promise<DeferredPromptRecord> {
    return await this.enqueue(async () => {
      const now = this.now()
      const store = await readStore(this.path)
      const kept: DeferredPromptRecord[] = []
      for (const existing of store.records) {
        if (now - existing.at > DEFERRED_PROMPT_TTL_MS) {
          logDaemonInfo(
            SUBSYSTEM,
            `expired deferred prompt ${existing.id} for ${existing.taskId}::${existing.tabId} (age ${Math.round((now - existing.at) / 1000)}s) — dropped`,
          )
          continue
        }
        if (existing.taskId === record.taskId && existing.tabId === record.tabId) {
          logDaemonInfo(
            SUBSYSTEM,
            `displaced deferred prompt ${existing.id} for ${record.taskId}::${record.tabId} (superseded by a newer deferral) — older text dropped`,
          )
          continue
        }
        kept.push(existing)
      }
      const next: DeferredPromptRecord = { ...record, id: randomUUID() }
      kept.push(next)
      await writeStore(this.path, kept)
      return next
    })
  }

  /** Fetch one record by id, or null when it was released/expired/displaced. */
  async get(id: string): Promise<DeferredPromptRecord | null> {
    return await this.enqueue(async () => (await readStore(this.path)).records.find((r) => r.id === id) ?? null)
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
