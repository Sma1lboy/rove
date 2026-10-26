/** Automation CRUD + manual-trigger RPC handlers. */

import { assertRoutineBaseRef, assertRoutineRepo } from "./automation-repo-check.ts"
import { type RunnerDeps, runAutomationOnce } from "./automation-runner.ts"
import {
  assertAutomationTargetOptions,
  assertAutomationTargetTask,
  mergeAutomationTargetOptions,
  readAutomationTarget,
} from "./automation-target.ts"
import { newWebhookSecret, readWebhookEvent, webhookSignatureValid } from "./automation-webhook.ts"
import {
  type AutomationPatch,
  type AutomationPrecheck,
  type AutomationRunStatus,
  ROUTINE_RESPONSE_MAX_CHARS,
} from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { isValidCron } from "./cron.ts"
import { reportDelivery, withDeliveryReport } from "./delivery-ops.ts"
import { optionalBoolean, optionalNumber, optionalString, optionalVendor, requireString } from "./handler-validators.ts"
import { deliveryDepsOf } from "./handlers-deliveries.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import { ensureRoutineCwd } from "./routine-dir.ts"

function runnerDepsOf(ctx: DaemonHandlerContext): RunnerDeps {
  return {
    store: ctx.automations,
    deliveries: ctx.deliveries,
    orch: ctx.orch,
    runtime: ctx.runtime,
    link: ctx.selfLink,
    ...(ctx.plugins ? { plugins: () => ctx.plugins ?? null } : {}),
    inbox: ctx.inbox,
  }
}

/** Why a webhook POST did or did not fire; the web server maps it to an HTTP status. */
export type WebhookVerdict = "fired" | "pong" | "not_found" | "bad_signature" | "disabled"

/** A persisted bad schedule never fires and is only discoverable by its silence. */
function requireSchedule(payload: Record<string, unknown>, key: string): string {
  const schedule = requireString(payload, key)
  if (!isValidCron(schedule)) throw new Error(`invalid cron expression: ${schedule}`)
  return schedule
}

/** `null` clears the precheck (or script); absent leaves it untouched. */
function readPrecheck(
  payload: Record<string, unknown>,
  key: "precheck" | "script" = "precheck",
): AutomationPrecheck | null | undefined {
  if (!(key in payload)) return undefined
  const raw = payload[key]
  if (raw === null) return null
  if (!raw || typeof raw !== "object") throw new Error(`${key} must be an object or null`)
  const command = requireString(raw as Record<string, unknown>, "command")
  // `automations-store.ts` keeps only `> 0`, so 0/negative would silently
  // become 120 on the next boot.
  const timeoutSeconds = optionalNumber(raw as Record<string, unknown>, "timeoutSeconds") ?? 120
  if (timeoutSeconds <= 0) throw new Error(`${key}.timeoutSeconds must be greater than zero`)
  return { command, timeoutSeconds }
}

/** A script routine launches no engine, so engine and delivery options would be silently ignored. */
function assertScriptOptions(value: {
  script?: AutomationPrecheck
  prompt?: string
  target?: unknown
  vendor?: unknown
  model?: unknown
  modelEffort?: unknown
  baseRef?: unknown
  persistentSession?: boolean
}): void {
  if (!value.script) {
    if (!value.prompt) throw new Error("a routine needs a prompt, or a script to run instead of an engine")
    return
  }
  if (value.target || value.vendor || value.model || value.modelEffort || value.baseRef || value.persistentSession) {
    throw new Error("a script routine cannot set target, vendor, model, effort, baseRef or persistentSession")
  }
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

const NO_PROJECT_BASE_REF = "a routine with no project has no base branch; drop baseRef or give it a repo"

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
      // Absent repo = projectless: runs happen in the routine's own directory.
      const repo = optionalString(payload, "repo")
      const baseRef = optionalString(payload, "baseRef")
      const target = "target" in payload ? readAutomationTarget(payload.target) : undefined
      if (!repo && baseRef) throw new Error(NO_PROJECT_BASE_REF)
      // Validate before persisting, not at the first unattended failure.
      if (repo && !target) await assertRoutineRepo(repo)
      if (repo && baseRef) await assertRoutineBaseRef(repo, baseRef)
      const model = optionalString(payload, "model")
      const modelEffort = optionalString(payload, "effort")
      const targetOptions = {
        target: target ?? undefined,
        vendor: optionalVendor(payload, "vendor"),
        model,
        modelEffort,
        baseRef,
        persistentSession: optionalBoolean(payload, "persistentSession"),
      }
      assertAutomationTargetOptions(targetOptions)
      const script = readPrecheck(payload, "script") ?? undefined
      const prompt = optionalString(payload, "prompt") ?? ""
      assertScriptOptions({ ...targetOptions, script, prompt })
      await assertAutomationTargetTask({ repo, target: target ?? undefined }, ctx.orch)
      const automation = await ctx.automations.create({
        name: requireString(payload, "name"),
        ...(repo ? { repo } : {}),
        ...(target ? { target } : {}),
        prompt: script ? "" : prompt,
        ...(script ? { script } : {}),
        ...(optionalBoolean(payload, "notify") === true ? { notify: true } : {}),
        ...(optionalBoolean(payload, "webhook") === true ? { webhook: { secret: newWebhookSecret() } } : {}),
        schedule: requireSchedule(payload, "schedule"),
        missedRunGraceMinutes: readGraceMinutes(payload) ?? 60,
        ...(optionalVendor(payload, "vendor") ? { vendor: optionalVendor(payload, "vendor") } : {}),
        ...(model ? { model } : {}),
        ...(modelEffort ? { modelEffort } : {}),
        ...(precheck ? { precheck } : {}),
        ...(baseRef ? { baseRef } : {}),
        ...(optionalBoolean(payload, "persistentSession") === true ? { persistentSession: true } : {}),
        ...(optionalBoolean(payload, "enabled") !== undefined ? { enabled: optionalBoolean(payload, "enabled") } : {}),
      })
      // A projectless routine's cwd must exist before its first firing; a save that can't make it is no save.
      if (!repo) {
        await ensureRoutineCwd(automation).catch(async (error) => {
          await ctx.automations.delete(automation.id)
          throw error
        })
      }
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
      // patchable (a routine never converts between a repo and no project), so
      // it's validated only at create.
      const nextBaseRef = "baseRef" in payload ? optionalString(payload, "baseRef") : undefined
      const currentRepo = ctx.automations.get(id)?.repo
      if (nextBaseRef && ctx.automations.get(id) && !currentRepo) throw new Error(NO_PROJECT_BASE_REF)
      if (nextBaseRef && currentRepo) await assertRoutineBaseRef(currentRepo, nextBaseRef)
      let patch: AutomationPatch = {
        ...(optionalString(payload, "name") !== undefined ? { name: optionalString(payload, "name") } : {}),
        ...(optionalString(payload, "prompt") !== undefined ? { prompt: optionalString(payload, "prompt") } : {}),
        ...(payload.vendor === null
          ? { vendor: null }
          : optionalVendor(payload, "vendor") !== undefined
            ? { vendor: optionalVendor(payload, "vendor") }
            : {}),
        // Wire key is `effort`, as on `task.create`; `null` or "" clears.
        ...("model" in payload ? { model: optionalString(payload, "model") ?? null } : {}),
        ...("effort" in payload ? { modelEffort: optionalString(payload, "effort") ?? null } : {}),
        ...("target" in payload ? { target: readAutomationTarget(payload.target) } : {}),
        ...("schedule" in payload ? { schedule: requireSchedule(payload, "schedule") } : {}),
        ...(readPrecheck(payload) !== undefined ? { precheck: readPrecheck(payload) } : {}),
        ...(readPrecheck(payload, "script") !== undefined ? { script: readPrecheck(payload, "script") } : {}),
        ...(optionalBoolean(payload, "notify") !== undefined ? { notify: optionalBoolean(payload, "notify") } : {}),
        ...("baseRef" in payload ? { baseRef: optionalString(payload, "baseRef") ?? null } : {}),
        ...(optionalBoolean(payload, "enabled") !== undefined ? { enabled: optionalBoolean(payload, "enabled") } : {}),
        ...(readGraceMinutes(payload) !== undefined ? { missedRunGraceMinutes: readGraceMinutes(payload) } : {}),
        ...(optionalBoolean(payload, "persistentSession") !== undefined
          ? { persistentSession: optionalBoolean(payload, "persistentSession") }
          : {}),
      }
      const current = ctx.automations.get(id)
      if (!current) throw new Error(`automation not found: ${id}`)
      // Turning it on again keeps the secret, so a configured sender keeps working.
      const webhook = optionalBoolean(payload, "webhook")
      if (webhook !== undefined) {
        patch = { ...patch, webhook: webhook ? (current.webhook ?? { secret: newWebhookSecret() }) : null }
      }
      const targetOptions = mergeAutomationTargetOptions(current, patch)
      assertAutomationTargetOptions(targetOptions)
      assertScriptOptions({
        ...targetOptions,
        script: patch.script === null ? undefined : (patch.script ?? current.script),
        prompt: patch.prompt ?? current.prompt,
      })
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
      return { runs: ctx.automations.runsFor(automationId).map((run) => withDeliveryReport(run, ctx.deliveries)) }
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
      const stored = ctx.automations.getRun(runId)
      if (!stored) return { run: null }
      // A run armed with a delivery answers through it: `routine-respond` is
      // the routine-flavoured spelling of `rove api report --outcome done`.
      if (stored.deliveryId && ctx.deliveries.get(stored.deliveryId)) {
        await reportDelivery(deliveryDepsOf(ctx), stored.deliveryId, { outcome: "done", summary: text })
        return { run: withDeliveryReport(stored, ctx.deliveries) }
      }
      // Predates deliveries: the response lives on the run itself.
      const run = await ctx.automations.setRunResponse(runId, text)
      return { run: run ?? null }
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
      const status = await runAutomationOnce(runnerDepsOf(ctx), automation, {
        scheduledFor: Date.now(),
        trigger: "manual",
      })
      return { status }
    },
  },
  {
    // A signed POST from the web server (`/hooks/routines/<id>`). Answers at once and runs in the
    // background: GitHub gives a delivery 10s, a run takes longer.
    name: "automation.webhook",
    async handle(payload, ctx) {
      const automation = ctx.automations.get(requireString(payload, "id"))
      // An unknown id and a routine without a webhook look the same from outside.
      if (!automation?.webhook) return { verdict: "not_found" satisfies WebhookVerdict }
      const body = typeof payload.body === "string" ? payload.body : ""
      if (!webhookSignatureValid(automation.webhook.secret, body, optionalString(payload, "signature"))) {
        return { verdict: "bad_signature" satisfies WebhookVerdict }
      }
      const name = optionalString(payload, "event")
      // GitHub's hello when a hook is added; nothing to run.
      if (name === "ping") return { verdict: "pong" satisfies WebhookVerdict }
      if (!automation.enabled) return { verdict: "disabled" satisfies WebhookVerdict }
      const event = readWebhookEvent(name, body)
      void runAutomationOnce(runnerDepsOf(ctx), automation, {
        scheduledFor: Date.now(),
        trigger: "webhook",
        event,
      }).catch((err: unknown) => logDaemonError("automation-webhook", err))
      return { verdict: "fired" satisfies WebhookVerdict, event: event.summary }
    },
  },
]
