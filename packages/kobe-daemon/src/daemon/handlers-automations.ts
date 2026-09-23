/** Automation CRUD + manual-trigger RPC handlers. */

import { assertRoutineBaseRef, assertRoutineRepo } from "./automation-repo-check.ts"
import { runAutomationOnce } from "./automation-runner.ts"
import {
  assertAutomationTargetOptions,
  assertAutomationTargetTask,
  mergeAutomationTargetOptions,
  readAutomationTarget,
} from "./automation-target.ts"
import {
  type AutomationPatch,
  type AutomationPrecheck,
  type AutomationRunStatus,
  ROUTINE_RESPONSE_MAX_CHARS,
} from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { isValidCron } from "./cron.ts"
import { optionalBoolean, optionalNumber, optionalString, optionalVendor, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

/** A persisted bad schedule never fires and is only discoverable by its silence. */
function requireSchedule(payload: Record<string, unknown>, key: string): string {
  const schedule = requireString(payload, key)
  if (!isValidCron(schedule)) throw new Error(`invalid cron expression: ${schedule}`)
  return schedule
}

/** `null` clears the precheck; absent leaves it untouched. */
function readPrecheck(payload: Record<string, unknown>): AutomationPrecheck | null | undefined {
  if (!("precheck" in payload)) return undefined
  const raw = payload.precheck
  if (raw === null) return null
  if (!raw || typeof raw !== "object") throw new Error("precheck must be an object or null")
  const command = requireString(raw as Record<string, unknown>, "command")
  // `automations-store.ts` keeps only `> 0`, so 0/negative would silently
  // become 120 on the next boot.
  const timeoutSeconds = optionalNumber(raw as Record<string, unknown>, "timeoutSeconds") ?? 120
  if (timeoutSeconds <= 0) throw new Error("precheck.timeoutSeconds must be greater than zero")
  return { command, timeoutSeconds }
}

/**
 * Refuse a negative grace window: it makes every firing `missed` until
 * `normalizeAutomation` rewrites it to 60 on the next boot. Zero is legal: no
 * slack beyond the discovering tick (see `resolveDueOccurrence`).
 */
function readGraceMinutes(payload: Record<string, unknown>): number | undefined {
  const value = optionalNumber(payload, "missedRunGraceMinutes")
  if (value !== undefined && value < 0) {
    throw new Error("missedRunGraceMinutes must be zero or more minutes")
  }
  return value
}

export const AUTOMATION_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "automation.list",
    async handle(_payload, ctx) {
      const automations = ctx.automations.list()
      // Latest run status so the list shows broken routines. Status only;
      // details stay behind `automation.runs`.
      const lastRunStatus: Record<string, AutomationRunStatus> = {}
      for (const automation of automations) {
        const latest = ctx.automations.runsFor(automation.id, 1)[0]
        if (latest) lastRunStatus[automation.id] = latest.status
      }
      return {
        automations,
        lastRunStatus,
        // Why the daemon stays up, without a second round-trip.
        keepsDaemonAlive: ctx.automations.hasEnabled(),
      }
    },
  },
  {
    name: "automation.create",
    async handle(payload, ctx) {
      const precheck = readPrecheck(payload)
      const repo = requireString(payload, "repo")
      const baseRef = optionalString(payload, "baseRef")
      const target = "target" in payload ? readAutomationTarget(payload.target) : undefined
      // Validate before persisting, not at the first unattended failure.
      if (!target) await assertRoutineRepo(repo)
      if (baseRef) await assertRoutineBaseRef(repo, baseRef)
      const targetOptions = {
        target: target ?? undefined,
        vendor: optionalVendor(payload, "vendor"),
        baseRef,
        persistentSession: optionalBoolean(payload, "persistentSession"),
      }
      assertAutomationTargetOptions(targetOptions)
      await assertAutomationTargetTask({ repo, target: target ?? undefined }, ctx.orch)
      const automation = await ctx.automations.create({
        name: requireString(payload, "name"),
        repo,
        ...(target ? { target } : {}),
        prompt: requireString(payload, "prompt"),
        schedule: requireSchedule(payload, "schedule"),
        missedRunGraceMinutes: readGraceMinutes(payload) ?? 60,
        ...(optionalVendor(payload, "vendor") ? { vendor: optionalVendor(payload, "vendor") } : {}),
        ...(precheck ? { precheck } : {}),
        ...(baseRef ? { baseRef } : {}),
        ...(optionalBoolean(payload, "persistentSession") === true ? { persistentSession: true } : {}),
        ...(optionalBoolean(payload, "enabled") !== undefined ? { enabled: optionalBoolean(payload, "enabled") } : {}),
      })
      // A new enabled schedule may be the daemon's only reason to stay up.
      ctx.daemon.reevaluateIdle()
      return { automation }
    },
  },
  {
    name: "automation.update",
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      // Validate a new base ref (a clear has nothing to check). The repo isn't
      // patchable, so it's validated only at create.
      const nextBaseRef = "baseRef" in payload ? optionalString(payload, "baseRef") : undefined
      const currentRepo = ctx.automations.get(id)?.repo
      if (nextBaseRef && currentRepo) await assertRoutineBaseRef(currentRepo, nextBaseRef)
      const patch: AutomationPatch = {
        ...(optionalString(payload, "name") !== undefined ? { name: optionalString(payload, "name") } : {}),
        ...(optionalString(payload, "prompt") !== undefined ? { prompt: optionalString(payload, "prompt") } : {}),
        ...(payload.vendor === null
          ? { vendor: null }
          : optionalVendor(payload, "vendor") !== undefined
            ? { vendor: optionalVendor(payload, "vendor") }
            : {}),
        ...("target" in payload ? { target: readAutomationTarget(payload.target) } : {}),
        ...("schedule" in payload ? { schedule: requireSchedule(payload, "schedule") } : {}),
        ...(readPrecheck(payload) !== undefined ? { precheck: readPrecheck(payload) } : {}),
        ...("baseRef" in payload ? { baseRef: optionalString(payload, "baseRef") ?? null } : {}),
        ...(optionalBoolean(payload, "enabled") !== undefined ? { enabled: optionalBoolean(payload, "enabled") } : {}),
        ...(readGraceMinutes(payload) !== undefined ? { missedRunGraceMinutes: readGraceMinutes(payload) } : {}),
        ...(optionalBoolean(payload, "persistentSession") !== undefined
          ? { persistentSession: optionalBoolean(payload, "persistentSession") }
          : {}),
      }
      const current = ctx.automations.get(id)
      if (!current) throw new Error(`automation not found: ${id}`)
      const targetOptions = mergeAutomationTargetOptions(current, patch)
      assertAutomationTargetOptions(targetOptions)
      // A stale target must remain pausable, clearable and repairable.
      if (patch.target) await assertAutomationTargetTask({ repo: current.repo, target: patch.target }, ctx.orch)
      const automation = await ctx.automations.update(id, patch)
      if (!automation) throw new Error(`automation not found: ${id}`)
      // Disabling the last one releases the hold; nothing else would notice.
      ctx.daemon.reevaluateIdle()
      return { automation }
    },
  },
  {
    name: "automation.delete",
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      const deleted = await ctx.automations.delete(id)
      if (deleted) {
        // Nothing else clears the routine's Inbox episode.
        await ctx.inbox.deleteRoutineEpisode(id).catch(() => {})
        ctx.daemon.reevaluateIdle()
      }
      return { deleted }
    },
  },
  {
    name: "automation.runs",
    async handle(payload, ctx) {
      const automationId = requireString(payload, "id")
      // `{runs:[]}` for an unknown id would read as "not run yet" and make an
      // agent wait instead of fixing the id.
      if (!ctx.automations.get(automationId)) throw new Error(`automation not found: ${automationId}`)
      return { runs: ctx.automations.runsFor(automationId) }
    },
  },
  {
    name: "automation.respond",
    async handle(payload, ctx) {
      const runId = requireString(payload, "runId")
      const text = requireString(payload, "text")
      if (text.length > ROUTINE_RESPONSE_MAX_CHARS) {
        throw new Error(`response is ${text.length} characters; the cap is ${ROUTINE_RESPONSE_MAX_CHARS}`)
      }
      const run = await ctx.automations.setRunResponse(runId, text)
      if (!run) return { run: null }
      const automation = ctx.automations.get(run.automationId)
      if (automation) {
        await ctx.inbox
          .recordRoutineResponse(
            { automationId: automation.id, name: automation.name, status: run.status, runNumber: run.runNumber },
            run.taskId ?? null,
            Date.now(),
          )
          // The response is already stored; an Inbox write must not fail the verb.
          .catch((err: unknown) => logDaemonError("automation-respond-inbox", err))
      }
      return { run }
    },
  },
  {
    name: "automation.runNow",
    blocking: true,
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      const automation = ctx.automations.get(id)
      if (!automation) throw new Error(`automation not found: ${id}`)
      // `manual` skips the precheck: the user asking is the answer.
      const status = await runAutomationOnce(
        {
          store: ctx.automations,
          orch: ctx.orch,
          runtime: ctx.runtime,
          link: ctx.selfLink,
          ...(ctx.plugins ? { plugins: () => ctx.plugins ?? null } : {}),
          inbox: ctx.inbox,
        },
        automation,
        { scheduledFor: Date.now(), trigger: "manual" },
      )
      return { status }
    },
  },
]
