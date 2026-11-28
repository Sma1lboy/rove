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
import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import { assertAutomationTargetOptions, mergeAutomationTargetOptions } from "./automation-target.ts"
import {
  MAX_RUNS_PER_AUTOMATION,
  nonEmptyString,
  pruneRuns,
  readAutomationsStoreFile,
  writeAutomationsStoreFile,
} from "./automations-store-codec.ts"
import { type Automation, type AutomationPatch, type AutomationRun, hasAutomationEventTrigger } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { nextCronAfter } from "./cron.ts"
import type { Delivery } from "./delivery-contracts.ts"
import { serialized } from "./json-file.ts"

export { MAX_RUNS_PER_AUTOMATION, pruneRuns }

export function defaultAutomationsPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "automations.json")
}

type Pins = Pick<Automation, "vendor" | "model" | "modelEffort">

function samePins(a: Pins, b: Pins): boolean {
  return a.vendor === b.vendor && a.model === b.model && a.modelEffort === b.modelEffort
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
      const loaded = await readAutomationsStoreFile(this.path)
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
      const schedule = nonEmptyString(input.schedule)
      const eventTriggers = input.eventTriggers?.length ? input.eventTriggers : undefined
      if (!schedule && !hasAutomationEventTrigger({ eventTriggers, webhook: input.webhook })) {
        throw new Error("a routine needs a schedule, an event trigger, or a webhook")
      }
      const nowMs = this.now()
      const iso = new Date(nowMs).toISOString()
      const { schedule: _s, eventTriggers: _e, ...rest } = input
      const automation: Automation = {
        ...rest,
        id: randomUUID(),
        enabled: input.enabled !== false,
        // Throws on an expression that parses but never fires.
        ...(schedule ? { schedule, nextRunAt: new Date(nextCronAfter(schedule, nowMs)).toISOString() } : {}),
        ...(eventTriggers ? { eventTriggers } : {}),
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
      // Decided inside the queue so it orders against `linkSessionTask`.
      const repinned =
        current.sessionTaskId !== undefined &&
        targetOptions.sessionTaskId === current.sessionTaskId &&
        !samePins(current, targetOptions)
      const nowMs = this.now()
      const schedule = patch.schedule === null ? undefined : (patch.schedule ?? current.schedule)
      const eventTriggers =
        patch.eventTriggers === null
          ? undefined
          : patch.eventTriggers !== undefined
            ? patch.eventTriggers.length > 0
              ? patch.eventTriggers
              : undefined
            : current.eventTriggers
      const webhook = patch.webhook === null ? undefined : (patch.webhook ?? current.webhook)
      if (!schedule && !hasAutomationEventTrigger({ eventTriggers, webhook })) {
        throw new Error("a routine needs a schedule, an event trigger, or a webhook")
      }
      const reanchor =
        schedule !== undefined &&
        (patch.schedule !== undefined || (patch.enabled === true && !current.enabled) || !current.nextRunAt)
      const next: Automation = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        ...targetOptions,
        ...(repinned ? { sessionTaskId: undefined } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.missedRunGraceMinutes !== undefined ? { missedRunGraceMinutes: patch.missedRunGraceMinutes } : {}),
        ...(schedule ? { schedule } : { schedule: undefined, nextRunAt: undefined }),
        ...(eventTriggers ? { eventTriggers } : { eventTriggers: undefined }),
        ...(patch.precheck === null
          ? { precheck: undefined }
          : patch.precheck !== undefined
            ? { precheck: patch.precheck }
            : {}),
        ...(patch.script === null ? { script: undefined } : patch.script !== undefined ? { script: patch.script } : {}),
        ...(patch.notify !== undefined ? { notify: patch.notify } : {}),
        ...(webhook ? { webhook } : { webhook: undefined }),
        ...(reanchor ? { nextRunAt: new Date(nextCronAfter(schedule, nowMs)).toISOString() } : {}),
        updatedAt: new Date(nowMs).toISOString(),
      }
      this.automations = this.automations.map((a, i) => (i === index ? next : a))
      await this.commit()
      return next
    })
  }

  /** Adopt a just-created standing task, unless the pins it launched with were
   *  replaced while it was being created. False when not adopted. */
  async linkSessionTask(
    id: string,
    taskId: string,
    launchedWith: Pick<Automation, "vendor" | "model" | "modelEffort">,
  ): Promise<boolean> {
    return await this.enqueue(async () => {
      const index = this.automations.findIndex((a) => a.id === id)
      if (index === -1) return false
      const current = this.automations[index] as Automation
      if (!samePins(current, launchedWith)) return false
      const next: Automation = { ...current, sessionTaskId: taskId, updatedAt: new Date(this.now()).toISOString() }
      this.automations = this.automations.map((a, i) => (i === index ? next : a))
      await this.commit()
      return true
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
      if (!current.schedule) return null
      if (expectedNextRunAt !== undefined && (!current.enabled || current.nextRunAt !== expectedNextRunAt)) return null
      const iso = new Date(afterMs).toISOString()
      let nextRunAt: string
      try {
        nextRunAt = new Date(nextCronAfter(current.schedule, afterMs)).toISOString()
      } catch (err) {
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

  /**
   * Keep on the run what its delivery concluded, for a delivery about to be deleted with its task.
   * Null for an unknown or pruned run id.
   */
  async settleRun(runId: string, delivery: Pick<Delivery, "status" | "report">): Promise<AutomationRun | null> {
    return await this.enqueue(async () => {
      const index = this.runs.findIndex((run) => run.id === runId)
      if (index === -1) return null
      const next: AutomationRun = {
        ...(this.runs[index] as AutomationRun),
        deliveryStatus: delivery.status,
        ...(delivery.report ? { response: { text: delivery.report.summary, at: delivery.report.at } } : {}),
      }
      this.runs = this.runs.map((run, i) => (i === index ? next : run))
      await this.commit()
      return next
    })
  }

  /**
   * The engine on (taskId, tabId) compacted or switched conversation: stamp the newest run delivered
   * there, so a standing session's next run sends the full prompt again. No-op for a non-routine task.
   */
  async markSessionCompacted(taskId: string, tabId: string | null): Promise<void> {
    await this.enqueue(async () => {
      const target = this.runs
        .filter(
          (r) =>
            r.taskId === taskId &&
            (r.status === "dispatched" || r.status === "revived") &&
            (tabId === null || !r.tabId || r.tabId === tabId),
        )
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.runNumber - a.runNumber)[0]
      if (!target || target.compactedAt) return
      const at = new Date(this.now()).toISOString()
      this.runs = this.runs.map((r) => (r === target ? { ...r, compactedAt: at } : r))
      await this.commit()
    })
  }

  private async commit(deletedAutomationIds?: ReadonlySet<string>): Promise<void> {
    this.runs = pruneRuns(this.runs, deletedAutomationIds)
    await writeAutomationsStoreFile(this.path, this.automations, this.runs)
  }

  /** Serialize mutations so concurrent RPC/sweep writes cannot clobber the file. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return serialized(this.path, operation)
  }
}
