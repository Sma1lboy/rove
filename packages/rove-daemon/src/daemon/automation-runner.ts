/**
 * Automation sweep: WHEN due schedules fire, and recording what happened.
 * WHERE the prompt lands is `automation-dispatch.ts`.
 *
 * Same shape as {@link startQuotaResumeRunner} (stateless tick, re-entrancy
 * latch, unref'd timer) and deliberately exempt from the `hasSubscribers`
 * gate: running with nobody attached is the point of a schedule.
 *
 * `Automation.nextRunAt` is an absolute on-disk timestamp, so a restarted
 * daemon re-discovers every armed schedule on its first tick; no re-arm pass.
 *
 * Downtime: an occurrence within `missedRunGraceMinutes` runs late, else it
 * records `skipped_missed`. Only the most recent missed occurrence is ever
 * RUN (a week offline must not stampede seven runs at boot); the ones passed
 * over are still COUNTED and recorded ({@link droppedOccurrences}).
 */

import type { DaemonRpcClient } from "../client/rpc.ts"
import { type DispatchOutcome, type DispatchRunnability, dispatchAutomation } from "./automation-dispatch.ts"
import { formatPrecheckSkip, precheckPassed, runAutomationPrecheck } from "./automation-precheck.ts"
import type { AutomationsStore } from "./automations-store.ts"
import {
  type Automation,
  type AutomationPrecheck,
  type AutomationPrecheckResult,
  type AutomationRunResponse,
  type AutomationRunStatus,
  type DaemonOrchestrator,
  automationRunNeedsAttention,
} from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { countCronBetween, latestCronAtOrBefore } from "./cron.ts"
import type { DeliveriesStore } from "./deliveries-store.ts"
import type { DispatchLedger } from "./dispatch-ledger.ts"
import type { GateLedger } from "./gate-handoff.ts"
import type { SkipVerdict } from "./runnability-contracts.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

/** How often the sweep looks for due schedules. Cron's own resolution is one
 *  minute, so a faster tick would only re-ask the same question. */
export const DEFAULT_AUTOMATION_TICK_MS = 60_000

/** Automations whose armed time has arrived. */
export function dueAutomations(automations: readonly Automation[], nowMs: number): Automation[] {
  return automations.filter((a) => {
    if (!a.enabled) return false
    const at = Date.parse(a.nextRunAt)
    return Number.isFinite(at) && at <= nowMs
  })
}

/**
 * Which occurrence this firing is for, and whether it is still worth running
 * (the whole missed-run policy, pure). `notBefore` is the creation time, so a
 * new schedule can't claim occurrences that predate it.
 *
 * The grace has a FLOOR of one tick: the sweep polls, so `now - scheduledFor`
 * is 0..tickMs on a healthy run, and `missedRunGraceMinutes: 0` would
 * otherwise mark every firing missed. Grace N = up to N minutes late, plus
 * the tick that discovered it.
 */
export function resolveDueOccurrence(
  automation: Automation,
  nowMs: number,
  tickMs: number = DEFAULT_AUTOMATION_TICK_MS,
): { scheduledFor: number; missed: boolean } | null {
  const notBefore = Date.parse(automation.createdAt)
  const scheduledFor = latestCronAtOrBefore(automation.schedule, nowMs, Number.isFinite(notBefore) ? notBefore : 0)
  // `nextRunAt` is stale for the current expression (hand edit, or an edit
  // that lost a race); the caller re-anchors.
  if (scheduledFor === null) return null
  const graceMs = automation.missedRunGraceMinutes * 60_000 + Math.max(tickMs, 0)
  return { scheduledFor, missed: nowMs - scheduledFor > graceMs }
}

/** The slice of the orchestrator this runner needs. `getTask` resolves a
 *  standing session's task before re-delivering into it. */
export type AutomationOrchestrator = Pick<DaemonOrchestrator, "createTask" | "getTask">

export type AutomationRuntime = Pick<
  DaemonRuntimeAdapter,
  "startTaskSessionWithPrompt" | "deliverPromptToLiveEngineDetailed" | "deliverPromptToLiveEngineTabDetailed"
> &
  Partial<Pick<DaemonRuntimeAdapter, "roveApiInvocation">>

export interface RunnerDeps {
  readonly store: AutomationsStore
  /** Every dispatched prompt owes a report; the delivery is armed before the paste. */
  readonly deliveries: Pick<DeliveriesStore, "arm" | "cancel" | "setTab">
  readonly orch: AutomationOrchestrator
  readonly runtime: AutomationRuntime
  /** In-process RPC client, or a getter: the server's self-link is built after
   *  the collectors start. */
  readonly link: DaemonRpcClient | (() => DaemonRpcClient)
  /** Plugin event sink (getter, same reason as `link`); one automation.* event
   *  per recorded run. */
  readonly plugins?: () => { handleUiReport(report: PluginRunReport): void } | null
  readonly inbox?: RunnerInbox
  readonly gates?: GateLedger
  /** Should-run: a scheduled firing at a task that cannot use it is recorded `skipped_blocked`. */
  readonly runnability?: DispatchRunnability
  /** The dispatch ledger: a firing that reached (or failed to reach) a task is a row there. */
  readonly dispatches?: Pick<DispatchLedger, "record">
  readonly now?: () => number
  readonly stopped?: () => boolean
}

/** The Inbox slice the runner needs: an unattended firing that needs a human
 *  has nowhere else to surface. */
export interface RunnerInbox {
  recordRoutineFailure(
    routine: { automationId: string; name: string; status: string; error?: string },
    taskId: string | null,
    at: number,
  ): Promise<void>
  /** Optional so a daemon booted with only the dispatch slice still runs. */
  deleteRoutineEpisode?(automationId: string, state?: "routine_failed"): Promise<void>
}

type PluginRunReport = {
  readonly kind: import("../plugins/manifest.ts").PluginEventName
  readonly taskId?: string
  readonly detail?: Record<string, unknown>
}

function runEventFor(status: AutomationRunStatus): PluginRunReport["kind"] {
  if (status === "dispatched" || status === "revived" || status === "ran") return "automation.dispatched"
  if (status === "dispatch_failed" || status === "script_failed") return "automation.failed"
  return "automation.skipped"
}

function resolveLink(link: RunnerDeps["link"]): DaemonRpcClient {
  return typeof link === "function" ? link() : link
}

/** Best-effort plugin event for one recorded run — never throws. */
function emitRunEvent(
  deps: RunnerDeps,
  automation: Automation,
  status: AutomationRunStatus,
  args: { scheduledFor: number; trigger: "scheduled" | "manual" },
  extra: { taskId?: string; tabId?: string; error?: string },
): void {
  if (extra.taskId && (status === "dispatched" || status === "revived" || status === "dispatch_failed")) {
    deps.dispatches?.record({
      kind: "routine",
      from: null,
      routine: automation.name,
      to: { taskId: extra.taskId, tabId: extra.tabId ?? null },
      promptHead: automation.prompt,
      delivered: status !== "dispatch_failed",
      ...(extra.error ? { reason: extra.error } : {}),
    })
  }
  // handleUiReport guards its own dispatch; the getter is a plain closure.
  deps.plugins?.()?.handleUiReport({
    kind: runEventFor(status),
    ...(extra.taskId ? { taskId: extra.taskId } : {}),
    detail: {
      automationId: automation.id,
      name: automation.name,
      repo: automation.repo,
      status,
      trigger: args.trigger,
      scheduledFor: new Date(args.scheduledFor).toISOString(),
      ...(extra.tabId ? { tabId: extra.tabId } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    },
  })
}

/**
 * Keep the Inbox agreeing with the latest run. Only outcomes that need a
 * person raise an episode ({@link automationRunNeedsAttention}; not
 * `skipped_precheck`, a healthy "nothing to do"); a working run clears it.
 * Best-effort: an Inbox write must never fail the already-recorded run.
 */
async function raiseOrClearInboxEpisode(
  deps: RunnerDeps,
  automation: Automation,
  status: AutomationRunStatus,
  extra: { taskId?: string; error?: string },
): Promise<void> {
  const inbox = deps.inbox
  if (!inbox) return
  const now = deps.now ?? Date.now
  const write = automationRunNeedsAttention(status)
    ? inbox.recordRoutineFailure(
        {
          automationId: automation.id,
          name: automation.name,
          status,
          ...(extra.error ? { error: extra.error } : {}),
        },
        extra.taskId ?? null,
        now(),
      )
    : // Failure episode only: an unread response to an earlier run stays.
      inbox.deleteRoutineEpisode?.(automation.id, "routine_failed")
  await write?.catch((err: unknown) => logDaemonError("automation-inbox", err))
}

/** Record a run the sweep decided NOT to make (both skip paths). */
async function recordSkip(
  deps: RunnerDeps,
  automation: Automation,
  status: AutomationRunStatus,
  scheduledFor: number,
  error: string,
): Promise<void> {
  const now = deps.now ?? Date.now
  await deps.store.recordRun({
    automationId: automation.id,
    scheduledFor: new Date(scheduledFor).toISOString(),
    status,
    trigger: "scheduled",
    at: new Date(now()).toISOString(),
    error,
  })
  emitRunEvent(deps, automation, status, { scheduledFor, trigger: "scheduled" }, { error })
}

/**
 * Occurrences between the armed time and the one the sweep found. A serial
 * pass with dropped re-entrant ticks lets one slow precheck stall every
 * routine behind it, and `latestCronAtOrBefore` returns only the newest
 * occurrence, so without this the skipped ones leave no record.
 */
function droppedOccurrences(automation: Automation, scheduledFor: number): { count: number; firstMs: number } | null {
  const armedAt = Date.parse(automation.nextRunAt)
  if (!Number.isFinite(armedAt) || armedAt >= scheduledFor) return null
  const count = countCronBetween(automation.schedule, armedAt, scheduledFor)
  return count > 0 ? { count, firstMs: armedAt } : null
}

/**
 * The delivered prompt: a one-line header naming the run and the verb that
 * answers it, then the routine's prompt unchanged. The prompt goes LAST: a
 * model replies in the language of the tokens nearest its turn.
 */
export function withRoutineRunHeader(
  automation: Pick<Automation, "name" | "prompt">,
  run: { runNumber: number },
  api: string,
  deliveryId: string,
): string {
  return `[ROVE ROUTINE] "${automation.name}" run #${run.runNumber} — when done, report with: ${api} report --delivery ${deliveryId} --outcome done|partial|blocked|failed --summary … [--evidence …]… [--next …]\n\n${automation.prompt}`
}

/**
 * A script routine's whole run: the command in the repo, no engine. Non-empty
 * stdout is the response; a failure carries its stderr as the error. Shares
 * the precheck's shell, output cap and timeout ceiling, and like the precheck
 * it runs inside the serial sweep, so a slow script delays later routines.
 */
async function runScript(
  script: AutomationPrecheck,
  automation: Automation,
  record: (
    status: AutomationRunStatus,
    extra: { error?: string; response?: AutomationRunResponse; precheckResult?: AutomationPrecheckResult },
  ) => Promise<AutomationRunStatus>,
  now: () => number,
): Promise<AutomationRunStatus> {
  const result = await runAutomationPrecheck(script, automation.repo)
  const stdout = result.stdout.trim()
  const response = stdout ? { response: { text: stdout, at: new Date(now()).toISOString() } } : {}
  if (precheckPassed(result)) return await record("ran", response)
  const reason = formatPrecheckSkip(result).replace(/^precheck/, "script")
  const stderr = result.stderr.trim()
  logDaemonInfo("automation", `${automation.name}: ${reason}`)
  return await record("script_failed", {
    ...response,
    error: stderr ? `${reason}: ${stderr.slice(-500)}` : reason,
  })
}

/** Execute one automation now, recording exactly one run. A manual trigger
 *  (`automation.runNow`) skips the precheck. */
export async function runAutomationOnce(
  deps: RunnerDeps,
  automation: Automation,
  args: { scheduledFor: number; trigger: "scheduled" | "manual" },
): Promise<AutomationRunStatus> {
  const now = deps.now ?? Date.now
  const reserved = deps.store.reserveRun(automation.id)
  const record = async (
    status: AutomationRunStatus,
    extra: {
      taskId?: string
      tabId?: string
      error?: string
      deliveryId?: string
      precheckResult?: Awaited<ReturnType<typeof runAutomationPrecheck>>
      blocked?: SkipVerdict
      response?: AutomationRunResponse
    } = {},
  ): Promise<AutomationRunStatus> => {
    await deps.store.recordRun(
      {
        automationId: automation.id,
        scheduledFor: new Date(args.scheduledFor).toISOString(),
        status,
        trigger: args.trigger,
        at: new Date(now()).toISOString(),
        ...extra,
      },
      reserved,
    )
    emitRunEvent(deps, automation, status, args, extra)
    await raiseOrClearInboxEpisode(deps, automation, status, extra)
    return status
  }

  const cancelled = (): boolean =>
    deps.stopped?.() === true ||
    deps.store.get(automation.id) !== automation ||
    (args.trigger === "scheduled" && !automation.enabled)
  if (cancelled())
    return await record("skipped_cancelled", {
      error: "routine disabled, changed, deleted or runner stopped before delivery",
    })

  if (args.trigger === "scheduled" && automation.precheck) {
    const result = await runAutomationPrecheck(automation.precheck, automation.repo)
    if (!precheckPassed(result)) {
      logDaemonInfo("automation", `skip ${automation.name}: ${formatPrecheckSkip(result)}`)
      return await record("skipped_precheck", { precheckResult: result, error: formatPrecheckSkip(result) })
    }
  }

  if (cancelled())
    return await record("skipped_cancelled", {
      error: "routine disabled, changed, deleted or runner stopped before delivery",
    })

  if (automation.script) return await runScript(automation.script, automation, record, now)

  let outcome: DispatchOutcome
  // Armed against the task the prompt lands in, BEFORE the paste: a failed
  // turn can fire its hook within milliseconds of it.
  let deliveryId: string | undefined
  const settleDelivery = async (delivered: { tabId?: string } | null): Promise<void> => {
    if (!deliveryId) return
    const id = deliveryId
    if (delivered === null) deliveryId = undefined
    await (delivered === null
      ? deps.deliveries.cancel(id)
      : deps.deliveries.setTab(id, delivered.tabId ?? "tab-1")
    ).catch((err: unknown) => logDaemonError("automation-delivery", err))
  }
  try {
    outcome = await dispatchAutomation(
      {
        canDeliver: () => !cancelled(),
        orch: deps.orch,
        runtime: deps.runtime,
        link: () => resolveLink(deps.link),
        ...(deps.gates ? { gates: deps.gates } : {}),
        // A manual run is the owner asking now: it bypasses should-run like the precheck.
        ...(deps.runnability && args.trigger === "scheduled" ? { runnability: deps.runnability } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      },
      automation,
      async (target) => {
        const delivery = await deps.deliveries.arm({
          taskId: target.taskId,
          tabId: target.tabId,
          source: "routine",
          automationRunId: reserved.id,
          promptHead: automation.prompt,
        })
        deliveryId = delivery.id
        return withRoutineRunHeader(automation, reserved, deps.runtime.roveApiInvocation?.() ?? "rove api", delivery.id)
      },
    )
  } catch (err) {
    // A moved or forgotten repo: the target is gone, not the schedule.
    const error = err instanceof Error ? err.message : String(err)
    logDaemonError("automation-dispatch", err)
    await settleDelivery(null)
    return await record("skipped_unavailable", { error })
  }
  // Only a prompt that reached an engine owes a report.
  await settleDelivery(outcome.status === "dispatched" || outcome.status === "revived" ? outcome : null)

  // Persist the standing-session link BEFORE recording the run: a crash
  // between the two costs one run record, while the reverse would leave the
  // routine building a second standing task on its next firing.
  if (outcome.sessionTaskIdToSet) {
    // The task launched with `automation`'s pins; adopted only if they still stand.
    const linked = await deps.store
      .linkSessionTask(automation.id, outcome.sessionTaskIdToSet, automation)
      .catch((err) => {
        logDaemonError("automation-session-link", err)
        return true
      })
    if (!linked) logDaemonInfo("automation", `${automation.name}: not adopting ${outcome.sessionTaskIdToSet}`)
  } else if (outcome.sessionTaskIdToClear) {
    await deps.store
      .update(automation.id, { sessionTaskId: null })
      .catch((err) => logDaemonError("automation-session-unlink", err))
  }

  if (outcome.status === "dispatched" || outcome.status === "revived") {
    logDaemonInfo("automation", `${outcome.status} ${automation.name} task=${outcome.taskId}`)
  }
  return await record(outcome.status, {
    ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
    ...(outcome.tabId ? { tabId: outcome.tabId } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.blocked ? { blocked: outcome.blocked } : {}),
    ...(deliveryId ? { deliveryId } : {}),
  })
}

/** One sweep pass. `tickMs` sets the grace floor ({@link resolveDueOccurrence}). */
export async function sweepAutomations(deps: RunnerDeps, tickMs: number = DEFAULT_AUTOMATION_TICK_MS): Promise<void> {
  const now = deps.now ?? Date.now
  for (const automation of dueAutomations(deps.store.list(), now())) {
    if (deps.stopped?.()) return
    const nowMs = now()
    const occurrence = resolveDueOccurrence(automation, nowMs, tickMs)
    if (!occurrence) {
      await deps.store.advanceNextRun(automation.id, nowMs)
      continue
    }

    // Read the gap BEFORE advancing: `nextRunAt` is what this automation was
    // armed for, and advancing overwrites it with the occurrence we found.
    const dropped = droppedOccurrences(automation, occurrence.scheduledFor)

    // Advance BEFORE doing any work: an overlapping sweep (or a slow engine
    // spawn) must never see this occurrence as still due and fire it twice.
    const claimed = await deps.store.advanceNextRun(automation.id, occurrence.scheduledFor, automation.nextRunAt)
    if (!claimed) continue

    // One row for the skipped occurrences, recorded whatever happens next.
    if (dropped) {
      const first = new Date(dropped.firstMs).toISOString()
      await recordSkip(
        deps,
        automation,
        "skipped_missed",
        dropped.firstMs,
        `${dropped.count} earlier occurrence${dropped.count === 1 ? "" : "s"} never ran (from ${first})`,
      ).catch((err) => logDaemonError("automation-dropped", err))
    }

    if (occurrence.missed) {
      await recordSkip(
        deps,
        automation,
        "skipped_missed",
        occurrence.scheduledFor,
        `missed by more than the ${automation.missedRunGraceMinutes}m grace window`,
      )
      continue
    }

    await runAutomationOnce(deps, claimed, {
      scheduledFor: occurrence.scheduledFor,
      trigger: "scheduled",
    }).catch((err) => logDaemonError("automation-run", err))
  }
}

/** Start the sweep. `tickMs: 0` disables it (the test harness zeroes every collector). */
export function startAutomationRunner(
  deps: RunnerDeps,
  tickMs: number = DEFAULT_AUTOMATION_TICK_MS,
): ReturnType<typeof startTicker> {
  // Ungated: a schedule must not require an audience.
  let stopped = false
  return startTicker({
    name: "automation-sweep",
    tickMs,
    run: () => sweepAutomations({ ...deps, stopped: () => stopped }, tickMs),
    onStop: () => {
      stopped = true
    },
  })
}
