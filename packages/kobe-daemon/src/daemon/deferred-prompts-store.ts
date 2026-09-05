/**
 * Durable deferred-prompt store.
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
 * - records older than {@link DEFERRED_PROMPT_TTL_MS} are returned to the
 *   queue drainer for coordinated record + Inbox cleanup;
 * - a HUMAN dismiss marks {@link DeferredPromptRecord.dismissedAt} rather than
 *   deleting: the text stays releasable until its ordinary TTL, and only the
 *   sweep destroys it. Closing a tab or deleting a task still drops it
 *   outright — there is nothing left to release it into.
 */

import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import { logDaemonInfo } from "./crash-log.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"

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
  /** Confirmed PTY delivery; retained only while Inbox cleanup is pending. */
  readonly deliveredAt?: number
  /** Persisted before the PTY write: an ambiguous attempt may clean up, never retry. */
  readonly deliveryStartedAt?: number
  /**
   * Epoch ms of a HUMAN dismiss from the Inbox (or `deferred-dismiss`).
   *
   * Dismiss used to delete the text on the spot, which made one keystroke on a
   * card that said only "message queued — 23h" an unrecoverable loss: the
   * sender had already exited 0. A dismissed record keeps its text until the
   * ordinary TTL sweep, so `deferred-list --include-dismissed` still shows it
   * and `deferred-release` still delivers it. It is invisible to everything
   * else — its tab's slot is free, the flush skips it, and its Inbox pointer
   * is gone — so dismissing still means "get this out of my way".
   */
  readonly dismissedAt?: number
}

export interface DeferredPromptClaim {
  readonly claimId: string
  readonly record: DeferredPromptRecord
}

export type DeferredPromptClaimResult =
  | { readonly kind: "claimed"; readonly claim: DeferredPromptClaim }
  | { readonly kind: "in-flight" }
  | { readonly kind: "missing" }

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

export function defaultDeferredPromptsPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
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
    ...(typeof raw.deliveredAt === "number" && Number.isFinite(raw.deliveredAt)
      ? { deliveredAt: raw.deliveredAt }
      : {}),
    ...(typeof raw.deliveryStartedAt === "number" && Number.isFinite(raw.deliveryStartedAt)
      ? { deliveryStartedAt: raw.deliveryStartedAt }
      : {}),
    ...(typeof raw.dismissedAt === "number" && Number.isFinite(raw.dismissedAt)
      ? { dismissedAt: raw.dismissedAt }
      : {}),
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
  const body: DeferredPromptsFile = { version: 1, records: [...records] }
  await writeJsonAtomic(path, body)
}

const SUBSYSTEM = "deferred-prompts"

/** `A` = the keystroke window, `B` = the composer screen read — the same two
 *  letters the delivery-guard setting and its docs name. */
function layerCode(layer: DeferredPromptLayer): "A" | "B" {
  return layer === "recent-human-write" ? "A" : "B"
}

export class DeferredPromptsStore {
  private readonly claims = new Map<string, { claimId: string; done: Promise<void>; finish: () => void }>()

  constructor(
    private readonly path = defaultDeferredPromptsPath(),
    private readonly now = () => Date.now(),
  ) {}

  /** Serialize read-modify-write on the shared file (same unit as the inbox store). */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return serialized(this.path, operation)
  }

  /**
   * Store one deferred prompt when its (taskId, tabId) slot is vacant, while
   * ignoring TTL-expired records when checking occupancy. A live
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
          if (this.claims.has(existing.id)) {
            if (existing.taskId === record.taskId && existing.tabId === record.tabId) {
              throw new Error(`deferred prompt ${existing.id} expiry cleanup is in flight`)
            }
            kept.push(existing)
            continue
          }
          if (existing.taskId === record.taskId && existing.tabId === record.tabId) {
            logDaemonInfo(
              SUBSYSTEM,
              `expired deferred prompt ${existing.id} for ${existing.taskId}::${existing.tabId} replaced by a new deferral`,
            )
            continue
          }
          // Keep it until list() hands its identity to the daemon, which can
          // delete the matching Inbox pointer before resolving the record.
          kept.push(existing)
          continue
        }
        // A dismissed record is retained TEXT, not a held slot: the human said
        // "not this one", so the next send must be accepted rather than
        // refused with DEFERRED_PROMPT_PENDING.
        if (
          existing.taskId === record.taskId &&
          existing.tabId === record.tabId &&
          existing.dismissedAt === undefined
        ) {
          occupied = existing
        }
        kept.push(existing)
      }
      if (occupied) throw new DeferredPromptPendingError(occupied)
      const next: DeferredPromptRecord = { ...record, id: randomUUID() }
      kept.push(next)
      await writeStore(this.path, kept)
      logDaemonInfo(
        SUBSYSTEM,
        `held ${next.id} for ${next.taskId}::${next.tabId} layer=${layerCode(next.layer)} from=${next.senderLabel ?? "unknown"}`,
      )
      return next
    })
  }

  /** Fetch one record by id, or null when absent after release or later expiry cleanup. */
  async get(id: string): Promise<DeferredPromptRecord | null> {
    return await this.enqueue(async () => (await readStore(this.path)).records.find((r) => r.id === id) ?? null)
  }

  /** Claim one record for the whole delivery/cleanup transaction. */
  async claim(id: string): Promise<DeferredPromptClaimResult> {
    return await this.enqueue(async () => {
      if (this.claims.has(id)) return { kind: "in-flight" }
      const record = (await readStore(this.path)).records.find((candidate) => candidate.id === id)
      if (!record) return { kind: "missing" }
      const claimId = randomUUID()
      let finish = () => {}
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      this.claims.set(id, { claimId, done, finish })
      return { kind: "claimed", claim: { claimId, record } }
    })
  }

  /** Persist the no-redelivery boundary before attempting a PTY write. */
  async beginDelivery(claim: DeferredPromptClaim): Promise<DeferredPromptRecord> {
    return await this.enqueue(async () => {
      this.requireClaim(claim)
      const store = await readStore(this.path)
      const current = store.records.find((record) => record.id === claim.record.id)
      if (!current) throw new Error(`deferred prompt ${claim.record.id} disappeared while claimed`)
      const started = current.deliveryStartedAt !== undefined ? current : { ...current, deliveryStartedAt: this.now() }
      if (current.deliveryStartedAt === undefined) {
        await writeStore(
          this.path,
          store.records.map((record) => (record.id === current.id ? started : record)),
        )
      }
      return started
    })
  }

  /** Undo the boundary only when the runtime confirms no PTY write occurred. */
  async resetDelivery(claim: DeferredPromptClaim): Promise<void> {
    await this.enqueue(async () => {
      this.requireClaim(claim)
      const store = await readStore(this.path)
      const current = store.records.find((record) => record.id === claim.record.id)
      if (!current) throw new Error(`deferred prompt ${claim.record.id} disappeared while claimed`)
      if (current.deliveryStartedAt === undefined) return
      const { deliveryStartedAt: _deliveryStartedAt, ...reset } = current
      await writeStore(
        this.path,
        store.records.map((record) => (record.id === current.id ? reset : record)),
      )
    })
  }

  /** Persist confirmed delivery before cross-store Inbox cleanup. */
  async markDelivered(claim: DeferredPromptClaim): Promise<DeferredPromptRecord> {
    return await this.enqueue(async () => {
      this.requireClaim(claim)
      const store = await readStore(this.path)
      const current = store.records.find((record) => record.id === claim.record.id)
      if (!current) throw new Error(`deferred prompt ${claim.record.id} disappeared while claimed`)
      const delivered = current.deliveredAt ? current : { ...current, deliveredAt: this.now() }
      if (!current.deliveredAt) {
        logDaemonInfo(SUBSYSTEM, `released ${current.id} for ${current.taskId}::${current.tabId}`)
        await writeStore(
          this.path,
          store.records.map((record) => (record.id === current.id ? delivered : record)),
        )
      }
      return delivered
    })
  }

  /** Finish a claimed record after its Inbox pointer is gone. */
  async completeClaim(claim: DeferredPromptClaim): Promise<boolean> {
    return await this.enqueue(async () => {
      this.requireClaim(claim)
      const store = await readStore(this.path)
      const kept = store.records.filter((record) => record.id !== claim.record.id)
      if (kept.length !== store.records.length) await writeStore(this.path, kept)
      this.finishClaim(claim.record.id)
      return kept.length !== store.records.length
    })
  }

  /** Relinquish a failed/busy claim without changing the durable record. */
  async releaseClaim(claim: DeferredPromptClaim): Promise<void> {
    await this.enqueue(async () => {
      this.requireClaim(claim)
      this.finishClaim(claim.record.id)
    })
  }

  private requireClaim(claim: DeferredPromptClaim): void {
    if (this.claims.get(claim.record.id)?.claimId !== claim.claimId) {
      throw new Error(`deferred prompt ${claim.record.id} claim is no longer owned`)
    }
  }

  private finishClaim(id: string): void {
    const active = this.claims.get(id)
    this.claims.delete(id)
    active?.finish()
  }

  private async waitForClaims(taskId: string, tabId?: string): Promise<void> {
    for (;;) {
      const waiting = await this.enqueue(async () => {
        const records = (await readStore(this.path)).records.filter(
          (record) => record.taskId === taskId && (tabId === undefined || record.tabId === tabId),
        )
        return records.flatMap((record) => {
          const active = this.claims.get(record.id)
          return active ? [active.done] : []
        })
      })
      if (waiting.length === 0) return
      await Promise.all(waiting)
    }
  }

  /**
   * List every live record in insertion order. A flush is also a successful
   * store operation, so it enforces the same TTL boundary as filing a prompt.
   */
  async list(): Promise<{
    readonly records: readonly DeferredPromptRecord[]
    readonly dismissed: readonly DeferredPromptRecord[]
    readonly expired: readonly DeferredPromptRecord[]
  }> {
    return await this.enqueue(async () => {
      const now = this.now()
      const store = await readStore(this.path)
      const expired: DeferredPromptRecord[] = []
      const dismissed: DeferredPromptRecord[] = []
      const kept = store.records.filter((record) => {
        if (now - record.at <= DEFERRED_PROMPT_TTL_MS) {
          // Dismissed text is still releasable, but it is not queued work:
          // the flush must not deliver it and the default listing must not
          // report it as pending.
          if (record.dismissedAt !== undefined) {
            dismissed.push(record)
            return false
          }
          return true
        }
        expired.push(record)
        logDaemonInfo(
          SUBSYSTEM,
          `expired deferred prompt ${record.id} for ${record.taskId}::${record.tabId} (age ${Math.round((now - record.at) / 1000)}s) — cleanup requested`,
        )
        return false
      })
      // Deliberately does NOT write the prune: `flushDeferredPrompts` claims
      // each expired record so it can delete the record's Inbox pointer before
      // completing the claim. Dropping them here instead would strand those
      // pointers, which is why the log above says "cleanup requested".
      return { records: kept, dismissed, expired }
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
    await this.waitForClaims(taskId, tabId)
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

  /** Drop exactly one prompt referenced by an Inbox item, never its replacement. */
  async discard(id: string, reason: DeferredPromptDiscardReason): Promise<DeferredPromptRecord | null> {
    for (;;) {
      const waiting = await this.enqueue(async () => this.claims.get(id)?.done)
      if (!waiting) break
      await waiting
    }
    return await this.enqueue(async () => {
      const store = await readStore(this.path)
      const found = store.records.find((record) => record.id === id)
      if (!found) return null
      if (found.dismissedAt !== undefined) return found
      const dismissed: DeferredPromptRecord = { ...found, dismissedAt: this.now() }
      const expiresAt = new Date(found.at + DEFERRED_PROMPT_TTL_MS).toISOString()
      logDaemonInfo(
        SUBSYSTEM,
        `dismissed ${found.id} for ${found.taskId}::${found.tabId} — ${reason}; text retained until ${expiresAt}`,
      )
      await writeStore(
        this.path,
        store.records.map((record) => (record.id === id ? dismissed : record)),
      )
      return dismissed
    })
  }

  /** All records for a task (the exit path lists what is queued for a tab). */
  async listForTask(taskId: string): Promise<readonly DeferredPromptRecord[]> {
    return await this.enqueue(async () => (await readStore(this.path)).records.filter((r) => r.taskId === taskId))
  }

  /** Task deletion drops its queued prompts — logged, never silent. */
  async deleteTask(taskId: string): Promise<void> {
    await this.waitForClaims(taskId)
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
