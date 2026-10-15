/**
 * Durable, daemon-owned deliveries store: prompts handed to an engine tab with
 * an expectation of `rove api report`. Same shape as {@link AttentionInboxStore}
 * (in-memory list over one JSON document, mutations serialized per file,
 * tmp+rename writes, the daemon the only writer). A malformed file starts
 * empty; an I/O failure refuses to write rather than rewrite the file empty.
 */

import { readFile } from "node:fs/promises"
import { logDaemonError } from "./crash-log.ts"
import {
  DELIVERY_OUTCOMES,
  DELIVERY_PROMPT_HEAD_CHARS,
  type Delivery,
  type DeliveryMissingCause,
  type DeliveryReport,
  type DeliverySource,
  MAX_DELIVERIES_PER_TASK,
} from "./delivery-contracts.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"

interface DeliveriesFile {
  readonly version: 1
  readonly nextId: number
  readonly deliveries: Delivery[]
}

export interface ArmDeliveryInput {
  readonly taskId: string
  readonly tabId: string | null
  readonly source: DeliverySource
  readonly promptHead: string
  readonly automationRunId?: string
  readonly gateId?: string
}

const SOURCES: readonly string[] = ["routine", "send", "gate-answer"]
const STATUSES: readonly string[] = ["awaiting", "reported", "missing", "skipped"]
const CAUSES: readonly string[] = [
  "turn-complete",
  "turn-failed",
  "engine-dead",
  "stalled",
  "interrupted",
  "session-end",
  "rate-limited",
]

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function idNumber(id: string): number {
  return Number(id.slice(2))
}

function normalizeReport(value: unknown): DeliveryReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const raw = value as Partial<DeliveryReport>
  const at = str(raw.at)
  if (!DELIVERY_OUTCOMES.includes(raw.outcome as DeliveryReport["outcome"]) || typeof raw.summary !== "string" || !at)
    return undefined
  return {
    outcome: raw.outcome as DeliveryReport["outcome"],
    summary: raw.summary,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((e): e is string => typeof e === "string") : [],
    ...(str(raw.next) ? { next: raw.next } : {}),
    at,
  }
}

function normalizeDelivery(value: unknown): Delivery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Partial<Delivery>
  const id = str(raw.id)
  const taskId = str(raw.taskId)
  const at = str(raw.at)
  if (!id || !/^d-\d+$/.test(id) || !taskId || !at) return null
  if (!SOURCES.includes(raw.source as string) || !STATUSES.includes(raw.status as string)) return null
  const report = normalizeReport(raw.report)
  const missingAt = str(raw.missing?.at)
  const missing =
    raw.missing && CAUSES.includes(raw.missing.cause) && missingAt
      ? {
          cause: raw.missing.cause,
          ...(str(raw.missing.note) ? { note: raw.missing.note } : {}),
          at: missingAt,
        }
      : undefined
  return {
    id,
    taskId,
    tabId: str(raw.tabId) ?? null,
    source: raw.source as Delivery["source"],
    ...(str(raw.automationRunId) ? { automationRunId: raw.automationRunId } : {}),
    ...(str(raw.gateId) ? { gateId: raw.gateId } : {}),
    promptHead: typeof raw.promptHead === "string" ? raw.promptHead : "",
    at,
    status: raw.status as Delivery["status"],
    ...(str(raw.turnStartedAt) ? { turnStartedAt: raw.turnStartedAt } : {}),
    ...(missing ? { missing } : {}),
    ...(report ? { report } : {}),
  }
}

async function readStore(path: string): Promise<{ deliveries: Delivery[]; nextId: number }> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DeliveriesFile>
    const deliveries = Array.isArray(parsed.deliveries)
      ? parsed.deliveries.map(normalizeDelivery).filter((d): d is Delivery => d !== null)
      : []
    // Ids stay monotonic even after the newest rows were pruned.
    const floor = deliveries.reduce((n, d) => Math.max(n, idNumber(d.id) + 1), 1)
    const stored = typeof parsed.nextId === "number" && Number.isFinite(parsed.nextId) ? parsed.nextId : 1
    return { deliveries, nextId: Math.max(floor, stored) }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return { deliveries: [], nextId: 1 }
    // An I/O failure is not an empty store: the next write would destroy it.
    if (code !== undefined) throw err
    logDaemonError("deliveries-load", err)
    return { deliveries: [], nextId: 1 }
  }
}

/** Newest first: `at`, ties by id number. */
function compareNewestFirst(a: Delivery, b: Delivery): number {
  return Date.parse(b.at) - Date.parse(a.at) || idNumber(b.id) - idNumber(a.id)
}

/** Keep the newest {@link MAX_DELIVERIES_PER_TASK} per task. */
function prune(deliveries: readonly Delivery[]): Delivery[] {
  const seen = new Map<string, number>()
  const keep = new Set<string>()
  for (const d of [...deliveries].sort(compareNewestFirst)) {
    const n = (seen.get(d.taskId) ?? 0) + 1
    seen.set(d.taskId, n)
    if (n <= MAX_DELIVERIES_PER_TASK) keep.add(d.id)
  }
  return deliveries.filter((d) => keep.has(d.id))
}

/** Does `d` belong to an event on (taskId, tabId)? A null side matches any tab. */
function onTab(d: Delivery, taskId: string, tabId: string | null): boolean {
  return d.taskId === taskId && (tabId === null || d.tabId === null || d.tabId === tabId)
}

export class DeliveriesStore {
  private deliveries: Delivery[] = []
  private nextId = 1
  /** False until one read SUCCEEDED; {@link commit} refuses to write before that. */
  private loaded = false

  constructor(
    private readonly path: string,
    private readonly now = () => Date.now(),
  ) {}

  async init(): Promise<void> {
    await this.enqueue(async () => {
      const stored = await readStore(this.path)
      this.deliveries = stored.deliveries
      this.nextId = stored.nextId
      this.loaded = true
    })
  }

  get(id: string): Delivery | undefined {
    return this.deliveries.find((d) => d.id === id)
  }

  /** Newest first. */
  listForTask(taskId: string, limit = MAX_DELIVERIES_PER_TASK): Delivery[] {
    return this.deliveries
      .filter((d) => d.taskId === taskId)
      .sort(compareNewestFirst)
      .slice(0, limit)
  }

  /**
   * Awaiting deliveries an event on (taskId, tabId) could be ending, OLDEST
   * first: a tab's prompts run in arming order, so the oldest is the one the
   * engine is (or was last) working on. A delivery whose tab is not pinned yet
   * (`send --tab new`, paste in flight) answers to any tab's event unless
   * `exact` — a death record names ONE tab and must not end a paste headed
   * elsewhere.
   */
  awaitingOn(taskId: string, tabId: string | null, exact = false): Delivery[] {
    return this.deliveries
      .filter((d) => d.status === "awaiting" && onTab(d, taskId, tabId) && (!exact || d.tabId === tabId))
      .sort((a, b) => -compareNewestFirst(a, b))
  }

  /** The newest awaiting delivery on the tab: what a report with no id answers. */
  awaitingFor(taskId: string, tabId: string | null): Delivery | undefined {
    return this.awaitingOn(taskId, tabId).at(-1)
  }

  allAwaiting(): Delivery[] {
    return this.deliveries.filter((d) => d.status === "awaiting")
  }

  /** Persist a new `awaiting` delivery BEFORE the prompt is delivered: a
   *  failed turn can fire its hook within milliseconds of the paste. */
  async arm(input: ArmDeliveryInput): Promise<Delivery> {
    return await this.mutate((list, nextId) => {
      const delivery: Delivery = {
        id: `d-${nextId}`,
        taskId: input.taskId,
        tabId: input.tabId,
        source: input.source,
        ...(input.automationRunId ? { automationRunId: input.automationRunId } : {}),
        ...(input.gateId ? { gateId: input.gateId } : {}),
        promptHead: input.promptHead.slice(0, DELIVERY_PROMPT_HEAD_CHARS),
        at: new Date(this.now()).toISOString(),
        status: "awaiting",
      }
      return { list: [...list, delivery], result: delivery, nextId: nextId + 1 }
    })
  }

  /** Drop a delivery that never landed. Only an untouched `awaiting` row goes. */
  async cancel(id: string): Promise<boolean> {
    return await this.mutate((list) => {
      const found = list.find((d) => d.id === id && d.status === "awaiting")
      return { list: found ? list.filter((d) => d !== found) : list, result: found !== undefined }
    })
  }

  /** The tab the prompt actually landed in. */
  async setTab(id: string, tabId: string): Promise<Delivery | undefined> {
    return await this.patch(id, (d) => (d.tabId === tabId ? d : { ...d, tabId }))
  }

  /** A `turn-start` on the tab begins the oldest delivery whose turn has not started. */
  async noteTurnStart(taskId: string, tabId: string | null): Promise<void> {
    const target = this.awaitingOn(taskId, tabId).find((d) => !d.turnStartedAt)
    if (!target) return
    await this.patch(target.id, (d) => ({ ...d, turnStartedAt: new Date(this.now()).toISOString() }))
  }

  /** `awaiting` → `missing`. Undefined when the delivery is gone or already settled. */
  async markMissing(id: string, cause: DeliveryMissingCause, note?: string): Promise<Delivery | undefined> {
    const current = this.get(id)
    if (current?.status !== "awaiting") return undefined
    const at = new Date(this.now()).toISOString()
    return await this.patch(id, (d) => ({ ...d, status: "missing", missing: { cause, ...(note ? { note } : {}), at } }))
  }

  /** Record (or replace) the report. A `missing` delivery flips back to `reported`. */
  async setReport(
    id: string,
    report: Omit<DeliveryReport, "at">,
  ): Promise<{ delivery: Delivery; wasMissing: boolean } | undefined> {
    const before = this.get(id)
    if (!before) return undefined
    const at = new Date(this.now()).toISOString()
    const delivery = await this.patch(id, ({ missing: _gone, ...d }) => ({
      ...d,
      status: "reported",
      report: { ...report, at },
    }))
    return delivery ? { delivery, wasMissing: before.status === "missing" } : undefined
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.mutate((list) => {
      const next = list.filter((d) => d.taskId !== taskId)
      return { list: next.length === list.length ? list : next, result: undefined }
    })
  }

  /** Task deletion must continue even when persistence is unavailable. */
  async deleteTaskBestEffort(taskId: string): Promise<void> {
    await this.deleteTask(taskId).catch((err) => logDaemonError("deliveries-task-delete", err))
  }

  private async patch(id: string, fn: (d: Delivery) => Delivery): Promise<Delivery | undefined> {
    return await this.mutate((list) => {
      const index = list.findIndex((d) => d.id === id)
      if (index === -1) return { list, result: undefined }
      const updated = fn(list[index] as Delivery)
      return { list: list.map((d, i) => (i === index ? updated : d)), result: updated }
    })
  }

  private async mutate<T>(
    fn: (list: readonly Delivery[], nextId: number) => { list: readonly Delivery[]; result: T; nextId?: number },
  ): Promise<T> {
    return await this.enqueue(async () => {
      // Never write a file we could not read: that would erase it.
      if (!this.loaded) throw new Error(`deliveries never loaded (${this.path}) — refusing to overwrite it`)
      const out = fn(this.deliveries, this.nextId)
      if (out.list === this.deliveries && out.nextId === undefined) return out.result
      const next = prune(out.list)
      const nextId = out.nextId ?? this.nextId
      const body: DeliveriesFile = { version: 1, nextId, deliveries: next }
      await writeJsonAtomic(this.path, body)
      this.deliveries = next
      this.nextId = nextId
      return out.result
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return serialized(this.path, operation)
  }
}
