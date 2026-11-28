/**
 * On-disk JSON codec and run retention for `automations.json`, split out of
 * `automations-store.ts` so the store class owns mutations and this file owns
 * backwards-compatible serialization/normalization.
 */

import { readFile } from "node:fs/promises"
import { assertAutomationTargetOptions, readAutomationTarget } from "./automation-target.ts"
import { type Automation, type AutomationPrecheck, type AutomationRun, normalizeEventTriggers } from "./contracts.ts"
import { writeJsonAtomic } from "./json-file.ts"
import { parseSkipVerdict } from "./runnability-contracts.ts"
import { salvageUnreadable } from "./store-salvage.ts"

/** Per-automation run history cap; every write re-serializes the whole document. */
export const MAX_RUNS_PER_AUTOMATION = 100

interface AutomationsFile {
  readonly version: 1
  readonly automations: Automation[]
  readonly runs: AutomationRun[]
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** A precheck or script `{command, timeoutSeconds}`; a missing or bad timeout reads as 120. */
function readTimedCommand(value: unknown): AutomationPrecheck | undefined {
  if (!value || typeof value !== "object") return undefined
  const raw = value as Partial<AutomationPrecheck>
  const command = nonEmptyString(raw.command)
  if (!command) return undefined
  const timeoutSeconds = typeof raw.timeoutSeconds === "number" && raw.timeoutSeconds > 0 ? raw.timeoutSeconds : 120
  return { command, timeoutSeconds }
}

function normalizeAutomation(value: unknown): Automation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Partial<Automation>
  const id = nonEmptyString(raw.id)
  const name = nonEmptyString(raw.name)
  const repo = nonEmptyString(raw.repo)
  const prompt = nonEmptyString(raw.prompt)
  const schedule = nonEmptyString(raw.schedule)
  const nextRunAt = nonEmptyString(raw.nextRunAt)
  const eventTriggers = normalizeEventTriggers(raw.eventTriggers)
  const webhook = nonEmptyString(raw.webhook?.secret) ? { secret: raw.webhook?.secret as string } : undefined
  const script = readTimedCommand(raw.script)
  if (!id || !name || !(prompt || script)) return null
  if (!schedule && !eventTriggers?.length && !webhook) return null
  if (schedule && (!nextRunAt || !Number.isFinite(Date.parse(nextRunAt)))) return null

  let target: Automation["target"]
  try {
    target = raw.target === undefined ? undefined : (readAutomationTarget(raw.target) ?? undefined)
    assertAutomationTargetOptions({ ...raw, target })
  } catch {
    return null
  }
  const precheck = readTimedCommand(raw.precheck)
  // `lastRunAt` is the legacy on-disk spelling; read it so existing files keep the value.
  const lastOccurrenceAt = nonEmptyString(raw.lastOccurrenceAt ?? (value as { lastRunAt?: unknown }).lastRunAt)
  const grace = raw.missedRunGraceMinutes
  const now = new Date().toISOString()
  return {
    id,
    name,
    ...(repo ? { repo } : {}),
    prompt: prompt ?? "",
    ...(schedule ? { schedule, nextRunAt } : {}),
    ...(eventTriggers ? { eventTriggers } : {}),
    ...(target ? { target } : {}),
    enabled: raw.enabled !== false,
    missedRunGraceMinutes: typeof grace === "number" && Number.isFinite(grace) && grace >= 0 ? grace : 60,
    ...(raw.vendor ? { vendor: raw.vendor } : {}),
    ...(nonEmptyString(raw.model) ? { model: raw.model } : {}),
    ...(nonEmptyString(raw.modelEffort) ? { modelEffort: raw.modelEffort } : {}),
    ...(precheck ? { precheck } : {}),
    ...(script ? { script } : {}),
    ...(raw.notify === true ? { notify: true } : {}),
    ...(webhook ? { webhook } : {}),
    ...(nonEmptyString(raw.baseRef) ? { baseRef: raw.baseRef } : {}),
    ...(raw.persistentSession === true ? { persistentSession: true } : {}),
    ...(raw.newConversation === true ? { newConversation: true } : {}),
    ...(nonEmptyString(raw.sessionTaskId) ? { sessionTaskId: raw.sessionTaskId } : {}),
    ...(lastOccurrenceAt ? { lastOccurrenceAt } : {}),
    createdAt: nonEmptyString(raw.createdAt) ?? now,
    updatedAt: nonEmptyString(raw.updatedAt) ?? now,
  }
}

function normalizeRun(value: unknown): AutomationRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Partial<AutomationRun>
  const id = nonEmptyString(raw.id)
  const automationId = nonEmptyString(raw.automationId)
  const scheduledFor = nonEmptyString(raw.scheduledFor)
  const at = nonEmptyString(raw.at)
  if (!id || !automationId || !scheduledFor || !at) return null
  if (
    raw.status !== "dispatched" &&
    raw.status !== "revived" &&
    raw.status !== "skipped_cancelled" &&
    raw.status !== "skipped_precheck" &&
    raw.status !== "skipped_blocked" &&
    raw.status !== "skipped_missed" &&
    raw.status !== "skipped_unavailable" &&
    raw.status !== "dispatch_failed" &&
    raw.status !== "ran" &&
    raw.status !== "script_failed"
  ) {
    return null
  }
  const blocked = parseSkipVerdict(raw.blocked)
  return {
    id,
    automationId,
    runNumber: typeof raw.runNumber === "number" && raw.runNumber > 0 ? raw.runNumber : 1,
    scheduledFor,
    status: raw.status,
    trigger:
      raw.trigger === "manual" || raw.trigger === "webhook" || raw.trigger === "event" ? raw.trigger : "scheduled",
    ...(nonEmptyString(raw.event) ? { event: raw.event } : {}),
    ...(nonEmptyString(raw.taskId) ? { taskId: raw.taskId } : {}),
    ...(nonEmptyString(raw.tabId) ? { tabId: raw.tabId } : {}),
    ...(raw.precheckResult ? { precheckResult: raw.precheckResult } : {}),
    ...(blocked ? { blocked } : {}),
    ...(nonEmptyString(raw.error) ? { error: raw.error } : {}),
    ...(nonEmptyString(raw.deliveryId) ? { deliveryId: raw.deliveryId } : {}),
    ...(nonEmptyString(raw.promptHash) ? { promptHash: raw.promptHash } : {}),
    ...(raw.promptElided === true ? { promptElided: true as const } : {}),
    ...(nonEmptyString(raw.compactedAt) ? { compactedAt: raw.compactedAt } : {}),
    ...(typeof raw.response?.text === "string" && nonEmptyString(raw.response.at)
      ? { response: { text: raw.response.text, at: raw.response.at } }
      : {}),
    ...(raw.deliveryStatus === "reported" || raw.deliveryStatus === "quiet"
      ? { deliveryStatus: raw.deliveryStatus }
      : {}),
    at,
  }
}

export async function readAutomationsStoreFile(
  path: string,
): Promise<{ automations: Automation[]; runs: AutomationRun[] }> {
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
    // Unreadable is not empty: keep the bytes aside before any later write.
    salvageUnreadable(path, "automations-load", err)
    return { automations: [], runs: [] }
  }
}

export async function writeAutomationsStoreFile(
  path: string,
  automations: readonly Automation[],
  runs: readonly AutomationRun[],
): Promise<void> {
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
