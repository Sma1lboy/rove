/**
 * Durable, daemon-owned Automations store. Same shape as
 * {@link AttentionInboxStore}: in-memory map over one JSON document, mutations
 * serialized through a promise tail, tmp+rename writes. The daemon is the only
 * writer, so no cross-process lockfile. In-memory because the runner sweeps it
 * every 60s.
 *
 * Corruption: log and start empty; a malformed file must never block boot.
 */

import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import {
  assertAutomationTargetOptions,
  mergeAutomationTargetOptions,
  readAutomationTarget,
} from "./automation-target.ts"
import type { Automation, AutomationPatch, AutomationRun } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { nextCronAfter } from "./cron.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"

/** Per-automation run history cap; every write re-serializes the whole document. */
export const MAX_RUNS_PER_AUTOMATION = 100

interface AutomationsFile {
  readonly version: 1
  readonly automations: Automation[]
  readonly runs: AutomationRun[]
}

export function defaultAutomationsPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "automations.json")
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizeAutomation(value: unknown): Automation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Partial<Automation>
  const id = str(raw.id)
  const name = str(raw.name)
  const repo = str(raw.repo)
  const prompt = str(raw.prompt)
  const schedule = str(raw.schedule)
  const nextRunAt = str(raw.nextRunAt)
  if (!id || !name || !repo || !prompt || !schedule || !nextRunAt) return null
  if (!Number.isFinite(Date.parse(nextRunAt))) return null

  let target: Automation["target"]
  try {
    target = raw.target === undefined ? undefined : (readAutomationTarget(raw.target) ?? undefined)
    assertAutomationTargetOptions({ ...raw, target })
  } catch {
    return null
  }
  const precheckCommand = str(raw.precheck?.command)
  // `lastRunAt` is the legacy on-disk spelling; read it so existing files keep the value.
  const lastOccurrenceAt = str(raw.lastOccurrenceAt ?? (value as { lastRunAt?: unknown }).lastRunAt)
  const grace = raw.missedRunGraceMinutes
  const now = new Date().toISOString()
  return {
    id,
    name,
    repo,
    prompt,
    schedule,
    nextRunAt,
    ...(target ? { target } : {}),
    enabled: raw.enabled !== false,
    missedRunGraceMinutes: typeof grace === "number" && Number.isFinite(grace) && grace >= 0 ? grace : 60,
    ...(raw.vendor ? { vendor: raw.vendor } : {}),
    ...(precheckCommand
      ? {
          precheck: {
            command: precheckCommand,
            timeoutSeconds:
              typeof raw.precheck?.timeoutSeconds === "number" && raw.precheck.timeoutSeconds > 0
                ? raw.precheck.timeoutSeconds
                : 120,
          },
        }
      : {}),
    ...(str(raw.baseRef) ? { baseRef: raw.baseRef } : {}),
    ...(raw.persistentSession === true ? { persistentSession: true } : {}),
    ...(str(raw.sessionTaskId) ? { sessionTaskId: raw.sessionTaskId } : {}),
    ...(lastOccurrenceAt ? { lastOccurrenceAt } : {}),
    createdAt: str(raw.createdAt) ?? now,
    updatedAt: str(raw.updatedAt) ?? now,
  }
}

function normalizeRun(value: unknown): AutomationRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Partial<AutomationRun>
  const id = str(raw.id)
  const automationId = str(raw.automationId)
  const scheduledFor = str(raw.scheduledFor)
  const at = str(raw.at)
  if (!id || !automationId || !scheduledFor || !at) return null
  if (
    raw.status !== "dispatched" &&
    raw.status !== "revived" &&
    raw.status !== "skipped_cancelled" &&
    raw.status !== "skipped_precheck" &&
    raw.status !== "skipped_missed" &&
    raw.status !== "skipped_unavailable" &&
    raw.status !== "dispatch_failed"
  ) {
    return null
  }
  return {
    id,
    automationId,
    runNumber: typeof raw.runNumber === "number" && raw.runNumber > 0 ? raw.runNumber : 1,
    scheduledFor,
    status: raw.status,
    trigger: raw.trigger === "manual" ? "manual" : "scheduled",
    ...(str(raw.taskId) ? { taskId: raw.taskId } : {}),
    ...(str(raw.tabId) ? { tabId: raw.tabId } : {}),
    ...(raw.precheckResult ? { precheckResult: raw.precheckResult } : {}),
    ...(str(raw.error) ? { error: raw.error } : {}),
    ...(typeof raw.response?.text === "string" && str(raw.response.at)
      ? { response: { text: raw.response.text, at: raw.response.at } }
      : {}),
    at,
  }
}

async function readStore(path: string): Promise<{ automations: Automation[]; runs: AutomationRun[] }> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<AutomationsFile>
    const automations = Array.isArray(parsed.automations)
      ? parsed.automations.map(normalizeAutomation).filter((a): a is Automation => a !== null)
      : []
    const runs = Array.isArray(parsed.runs)
      ? parsed.runs.map(normalizeRun).filter((r): r is AutomationRun => r !== null)
      : []
    return { automations, runs }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { automations: [], runs: [] }
    logDaemonError("automations-load", err)
    return { automations: [], runs: [] }
  }
}

async function writeStore(path: string, automations: readonly Automation[], runs: readonly AutomationRun[]) {
  const body: AutomationsFile = { version: 1, automations: [...automations], runs: [...runs] }
  await writeJsonAtomic(path, body)
}

/**
 * Keep the newest {@link MAX_RUNS_PER_AUTOMATION} runs per automation (by
 * `at`, ties by `runNumber`).
 *
 * `deletedAutomationIds` is opt-IN, not "keep only live ids": the runner writes
 * runs while the store may be mid-mutation, so an unknown id is not garbage.
 */
export function pruneRuns(
  runs: readonly AutomationRun[],
  deletedAutomationIds: ReadonlySet<string> = new Set(),
  maxPer = MAX_RUNS_PER_AUTOMATION,
): AutomationRun[] {
  const byAutomation = new Map<string, AutomationRun[]>()
  for (const run of runs) {
    if (deletedAutomationIds.has(run.automationId)) continue
    const list = byAutomation.get(run.automationId)
    if (list) list.push(run)
    else byAutomation.set(run.automationId, [run])
  }
  const kept = new Set<string>()
  for (const list of byAutomation.values()) {
    list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.runNumber - a.runNumber)
    for (const run of list.slice(0, Math.max(0, maxPer))) kept.add(run.id)
  }
  // Survivors keep their original append order — callers read this as a log.
  return runs.filter((run) => kept.has(run.id))
}

export class AutomationsStore {
  private automations: Automation[] = []
  private runs: AutomationRun[] = []
  /** Highest run number handed out per automation, recorded or not yet. */
  private readonly reserved = new Map<string, number>()

  constructor(
    private readonly path: string,
    private readonly now = () => Date.now(),
  ) {}

  async init(): Promise<void> {
    await this.enqueue(async () => {
      const loaded = await readStore(this.path)
      this.automations = loaded.automations
      this.runs = loaded.runs
    })
  }

  list(): Automation[] {
    return [...this.automations]
  }

  get(id: string): Automation | undefined {
    return this.automations.find((a) => a.id === id)
  }

  /** Runs for one automation, newest first. */
  runsFor(automationId: string, limit = MAX_RUNS_PER_AUTOMATION): AutomationRun[] {
    return this.runs
      .filter((run) => run.automationId === automationId)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.runNumber - a.runNumber)
      .slice(0, limit)
  }

  /** True when any enabled automation exists — the daemon's keep-alive gate. */
  hasEnabled(): boolean {
    return this.automations.some((a) => a.enabled)
  }

  async create(
    input: Omit<Automation, "id" | "nextRunAt" | "createdAt" | "updatedAt" | "enabled"> & { enabled?: boolean },
  ): Promise<Automation> {
    return await this.enqueue(async () => {
      assertAutomationTargetOptions(input)
      const nowMs = this.now()
      const iso = new Date(nowMs).toISOString()
      const automation: Automation = {
        ...input,
        id: randomUUID(),
        enabled: input.enabled !== false,
        // Throws on an expression that parses but never fires.
        nextRunAt: new Date(nextCronAfter(input.schedule, nowMs)).toISOString(),
        createdAt: iso,
        updatedAt: iso,
      }
      this.automations = [...this.automations, automation]
      await this.commit()
      return automation
    })
  }

  async update(id: string, patch: AutomationPatch): Promise<Automation | null> {
    return await this.enqueue(async () => {
      const index = this.automations.findIndex((a) => a.id === id)
      if (index === -1) return null
      const current = this.automations[index] as Automation
      const targetOptions = mergeAutomationTargetOptions(current, patch)
      assertAutomationTargetOptions(targetOptions)
      const nowMs = this.now()
      const schedule = patch.schedule ?? current.schedule
      const next: Automation = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        ...targetOptions,
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.missedRunGraceMinutes !== undefined ? { missedRunGraceMinutes: patch.missedRunGraceMinutes } : {}),
        schedule,
        // `null` deletes the field rather than storing a null.
        ...(patch.precheck === null
          ? { precheck: undefined }
          : patch.precheck !== undefined
            ? { precheck: patch.precheck }
            : {}),
        // Re-anchor, else a stale nextRunAt fires on the replaced rule.
        ...(patch.schedule !== undefined ? { nextRunAt: new Date(nextCronAfter(schedule, nowMs)).toISOString() } : {}),
        updatedAt: new Date(nowMs).toISOString(),
      }
      this.automations = this.automations.map((a, i) => (i === index ? next : a))
      await this.commit()
      return next
    })
  }

  async delete(id: string): Promise<boolean> {
    return await this.enqueue(async () => {
      if (!this.automations.some((a) => a.id === id)) return false
      this.automations = this.automations.filter((a) => a.id !== id)
      // Drops its run history too, named explicitly: retention never drops an unknown id.
      await this.commit(new Set([id]))
      return true
    })
  }

  /** Move the schedule past `afterMs` and stamp `lastOccurrenceAt` (the
   *  SCHEDULED time). Called BEFORE dispatch so an overlapping sweep can't
   *  fire the same occurrence twice. */
  async advanceNextRun(id: string, afterMs: number, expectedNextRunAt?: string): Promise<Automation | null> {
    return await this.enqueue(async () => {
      const index = this.automations.findIndex((a) => a.id === id)
      if (index === -1) return null
      const current = this.automations[index] as Automation
      if (expectedNextRunAt !== undefined && (!current.enabled || current.nextRunAt !== expectedNextRunAt)) return null
      const iso = new Date(afterMs).toISOString()
      let nextRunAt: string
      try {
        nextRunAt = new Date(nextCronAfter(current.schedule, afterMs)).toISOString()
      } catch (err) {
        // An unresolvable schedule (hand edit, past once-only date) must not
        // wedge the sweep on a permanently-due row: disable it, surfaced in `automation-list`.
        logDaemonError("automations-advance", err)
        const disabled: Automation = { ...current, enabled: false, lastOccurrenceAt: iso, updatedAt: iso }
        this.automations = this.automations.map((a, i) => (i === index ? disabled : a))
        await this.commit()
        return disabled
      }
      const next: Automation = { ...current, nextRunAt, lastOccurrenceAt: iso, updatedAt: iso }
      this.automations = this.automations.map((a, i) => (i === index ? next : a))
      await this.commit()
      return next
    })
  }

  /**
   * Claim a run's id and number BEFORE dispatch, so the delivered prompt can
   * name the run it belongs to. Pass the result to {@link recordRun}.
   */
  reserveRun(automationId: string): { id: string; runNumber: number } {
    // From the highest number, NOT the retained count, or pruning reissues numbers.
    const recorded = this.runs.reduce(
      (n, run) => (run.automationId === automationId ? Math.max(n, run.runNumber) : n),
      0,
    )
    const runNumber = Math.max(recorded, this.reserved.get(automationId) ?? 0) + 1
    this.reserved.set(automationId, runNumber)
    return { id: randomUUID(), runNumber }
  }

  async recordRun(
    input: Omit<AutomationRun, "id" | "runNumber">,
    reserved?: { id: string; runNumber: number },
  ): Promise<AutomationRun> {
    return await this.enqueue(async () => {
      const { id, runNumber } = reserved ?? this.reserveRun(input.automationId)
      const run: AutomationRun = { ...input, id, runNumber }
      this.runs = [...this.runs, run]
      await this.commit()
      return run
    })
  }

  getRun(runId: string): AutomationRun | undefined {
    return this.runs.find((run) => run.id === runId)
  }

  /** Store (or replace) a run's response. Null for an unknown or pruned run id. */
  async setRunResponse(runId: string, text: string): Promise<AutomationRun | null> {
    return await this.enqueue(async () => {
      const index = this.runs.findIndex((run) => run.id === runId)
      if (index === -1) return null
      const next: AutomationRun = {
        ...(this.runs[index] as AutomationRun),
        response: { text, at: new Date(this.now()).toISOString() },
      }
      this.runs = this.runs.map((run, i) => (i === index ? next : run))
      await this.commit()
      return next
    })
  }

  private async commit(deletedAutomationIds?: ReadonlySet<string>): Promise<void> {
    this.runs = pruneRuns(this.runs, deletedAutomationIds)
    await writeStore(this.path, this.automations, this.runs)
  }

  /** Serialize mutations so concurrent RPC/sweep writes cannot clobber the file. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return serialized(this.path, operation)
  }
}
