/** Automation CRUD + manual-trigger RPC handlers. */

import { assertRoutineBaseRef, assertRoutineRepo } from "./automation-repo-check.ts"
import { runAutomationOnce } from "./automation-runner.ts"
import {
  assertAutomationTargetOptions,
  assertAutomationTargetTask,
  mergeAutomationTargetOptions,
  readAutomationTarget,
} from "./automation-target.ts"
import type { AutomationPatch, AutomationPrecheck, AutomationRunStatus } from "./contracts.ts"
import { isValidCron } from "./cron.ts"
import { optionalBoolean, optionalNumber, optionalString, optionalVendor, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

/** Reject an unusable schedule at the boundary — persisting one would leave a
 *  row that can never fire and is only discoverable by watching it not run. */
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
  // Same silent-rewrite trap as the grace window: `automations-store.ts` only
  // keeps a timeout `> 0`, so a 0 or negative one survives in memory and turns
  // into 120 on the next boot.
  const timeoutSeconds = optionalNumber(raw as Record<string, unknown>, "timeoutSeconds") ?? 120
  if (timeoutSeconds <= 0) throw new Error("precheck.timeoutSeconds must be greater than zero")
  return { command, timeoutSeconds }
}

/**
 * Read a grace window, refusing a negative one at the boundary.
 *
 * `optionalNumber` only rejects non-finite values, so `-1` used to pass and
 * make every firing `missed`, until `normalizeAutomation` silently rewrote it
 * to 60 on the next daemon boot — "it started working after I restarted the
 * daemon" is the resulting bug report. Zero is legal and means "no slack
 * beyond the tick that discovers the occurrence" (see `resolveDueOccurrence`).
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
      // The latest run's STATUS per routine, so a list can show which ones are
      // broken. Without it every row renders identically and finding the
      // failing routine means opening each one in turn — which is exactly the
      // work an unattended schedule is supposed to save. Status only: the
      // error text, the task and the precheck output stay behind
      // `automation.runs`, which the detail view already fetches.
      const lastRunStatus: Record<string, AutomationRunStatus> = {}
      for (const automation of automations) {
        const latest = ctx.automations.runsFor(automation.id, 1)[0]
        if (latest) lastRunStatus[automation.id] = latest.status
      }
      return {
        automations,
        lastRunStatus,
        // The keep-alive reason, surfaced so `automation-list` explains why the
        // daemon is staying up without a second round-trip.
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
      // Before persisting, not after the first firing: a routine that can
      // never resolve its worktree is a row the user cannot tell from a
      // healthy one until it has already failed unattended.
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
      // A base ref set here is as permanently fatal as one set at create, and
      // `--base-branch ''` (clear) has nothing to check. The repo is not
      // patchable, so it is validated only where it is chosen.
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
        // The routine's Inbox episode outlives the routine otherwise: nothing
        // else ever clears it, and the queue is meant to describe things that
        // still exist.
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
      // An unknown id used to answer `{runs:[]}`, which reads as "it exists and
      // has not run yet" — the one conclusion that makes an agent wait instead
      // of fixing the id. Same failure as `setEnabled` / `runNow`.
      if (!ctx.automations.get(automationId)) throw new Error(`automation not found: ${automationId}`)
      return { runs: ctx.automations.runsFor(automationId) }
    },
  },
  {
    name: "automation.runNow",
    blocking: true,
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      const automation = ctx.automations.get(id)
      if (!automation) throw new Error(`automation not found: ${id}`)
      // `trigger: "manual"` deliberately skips the precheck — the user asking
      // for it IS the answer to "is this worth running".
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
