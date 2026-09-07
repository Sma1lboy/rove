/**
 * Automation sweep: fire due schedules.
 *
 * WHERE a firing's prompt lands is `automation-dispatch.ts` (fresh task per
 * run, or one standing session re-delivered into). This module
 * owns only WHEN, and recording what happened.
 *
 * Shape copied wholesale from {@link startQuotaResumeRunner} — same stateless
 * tick, same re-entrancy latch, same unref'd timer, and the same deliberate
 * exemption from the `hasSubscribers` gate that every other collector honours:
 *
 *   Running with nobody attached is the entire point of a schedule.
 *
 * Restart behaviour falls out of the data model rather than any code here.
 * `Automation.nextRunAt` is an absolute timestamp on disk, so a daemon that
 * restarts (or was down for a day) re-discovers every armed schedule on its
 * first tick — there is no re-arm pass, and deliberately so.
 *
 * What the daemon being DOWN costs is a different question, and the one this
 * module actually has to answer: an occurrence that came and went unobserved.
 * That is `missedRunGraceMinutes` — run it late if it is still recent enough
 * to be useful, otherwise record `skipped_missed` and move on. Only the most
 * recent missed occurrence is ever RUN; a week offline must not stampede
 * seven runs at boot. The ones passed over are still COUNTED and recorded
 * ({@link droppedOccurrences}), because "did not run it" and "did not mention
 * it" are different promises, and only the second one is a lie.
 */

import type { DaemonRpcClient } from "../client/rpc.ts"
import { type DispatchInbox, dispatchAutomation } from "./automation-dispatch.ts"
import { formatPrecheckSkip, precheckPassed, runAutomationPrecheck } from "./automation-precheck.ts"
import type { AutomationsStore } from "./automations-store.ts"
import {
  type Automation,
  type AutomationRunStatus,
  type DaemonOrchestrator,
  automationRunNeedsAttention,
} from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { countCronBetween, latestCronAtOrBefore } from "./cron.ts"
import type { DeferredPromptsStore } from "./deferred-prompts-store.ts"
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
 * Which occurrence this firing is for, and whether it is still worth running.
 *
 * Split out as a pure function because it is the whole missed-run policy and
 * deserves to be tested without a clock or a filesystem. `notBefore` is the
 * automation's creation time so a brand-new schedule cannot claim occurrences
 * that predate it.
 *
 * The grace window has a FLOOR of one tick, because the sweep is a poller:
 * `scheduledFor` is the occurrence at or before now, and the earliest the
 * sweep can possibly see it is the tick that follows it, so `now -
 * scheduledFor` is somewhere in 0..tickMs on a perfectly healthy run. Without
 * the floor, `missedRunGraceMinutes: 0` made `missed` true on EVERY firing:
 * the automation recorded `skipped_missed` forever and never dispatched, and
 * zero looks like a reasonable setting. So a grace of N means "up to and
 * including N minutes late, plus the tick that discovered it".
 */
export function resolveDueOccurrence(
  automation: Automation,
  nowMs: number,
  tickMs: number = DEFAULT_AUTOMATION_TICK_MS,
): { scheduledFor: number; missed: boolean } | null {
  const notBefore = Date.parse(automation.createdAt)
  const scheduledFor = latestCronAtOrBefore(automation.schedule, nowMs, Number.isFinite(notBefore) ? notBefore : 0)
  // No occurrence at or before now means `nextRunAt` is stale relative to the
  // current expression (a hand-edited file, or an edit that lost a race). The
  // caller just re-anchors the schedule.
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
>

interface RunnerDeps {
  readonly store: AutomationsStore
  readonly orch: AutomationOrchestrator
  readonly runtime: AutomationRuntime
  /** The daemon's in-process RPC client, or a getter for it — the server's
   *  self-link is constructed after the collectors start, and the sweep only
   *  needs it on a tick. */
  readonly link: DaemonRpcClient | (() => DaemonRpcClient)
  /** Plugin event sink (getter for the same construction-order reason as
   *  `link`). Every recorded run fires one automation.* plugin event. */
  readonly plugins?: () => { handleUiReport(report: PluginRunReport): void } | null
  /** Ownership of a prompt a busy composer refused (standing sessions only).
   *  Absent in a daemon booted without the stores; the firing then records a
   *  failure rather than dropping the report silently. */
  readonly deferred?: DeferredPromptsStore
  readonly inbox?: RunnerInbox
  readonly now?: () => number
  readonly stopped?: () => boolean
}

/**
 * The Inbox slice the RUNNER needs, on top of the dispatch path's.
 *
 * A schedule is the only thing here that acts unattended, so a firing that
 * needs a human has nowhere else to surface: the run history records it, but
 * reading the run history is exactly the going-and-looking a schedule exists
 * to avoid.
 */
export interface RunnerInbox extends DispatchInbox {
  recordRoutineFailure(
    routine: { automationId: string; name: string; status: string; error?: string },
    taskId: string | null,
    at: number,
  ): Promise<void>
  /** Optional so a daemon booted with only the dispatch slice still runs. */
  deleteRoutineEpisode?(automationId: string): Promise<void>
}

type PluginRunReport = {
  readonly kind: import("../plugins/manifest.ts").PluginEventName
  readonly taskId?: string
  readonly detail?: Record<string, unknown>
}

/** Queue acceptance is not delivery. Deferred runs carry their status on
 * the skipped event until the queue's owner performs delivery. */
function runEventFor(status: AutomationRunStatus): PluginRunReport["kind"] {
  if (status === "dispatched" || status === "revived") return "automation.dispatched"
  if (status === "dispatch_failed") return "automation.failed"
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
  extra: { taskId?: string; tabId?: string; deferredId?: string; error?: string },
): void {
  // handleUiReport guards its own dispatch — a throw can only come from the
  // getter, which is a plain closure over the server's pluginHost.
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
      ...(extra.deferredId ? { deferredId: extra.deferredId } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    },
  })
}

/**
 * Keep the Inbox agreeing with the latest run.
 *
 * Only the outcomes that need a person raise an episode
 * ({@link automationRunNeedsAttention}) — `skipped_precheck` is a healthy
 * routine finding nothing to do, and filing that would train the user to
 * ignore the queue. A run that goes back to working clears the episode, so a
 * routine that was broken and is fixed does not leave a permanent scar.
 * Best-effort throughout: the Inbox is a notification, and failing to write
 * one must never fail the run that was already recorded.
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
    : inbox.deleteRoutineEpisode?.(automation.id)
  await write?.catch((err: unknown) => logDaemonError("automation-inbox", err))
}

/** Record a run the sweep decided NOT to make. Shared by both skip paths so
 *  the record + plugin event never drift apart between them. */
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
 * Occurrences this automation was armed for that the sweep never reached.
 *
 * A sweep pass is serial and its ticker drops re-entrant ticks, so one slow
 * precheck stalls every routine behind it. The stall itself is bounded and
 * survivable; the LIE is not. `latestCronAtOrBefore` returns only the newest
 * occurrence, so the ones passed over used to vanish with no record of any
 * kind — a per-minute routine that fired five times out of nine showed five
 * `dispatched` runs and nothing else. This is the gap between what the
 * automation was armed for and what the sweep actually found.
 */
function droppedOccurrences(automation: Automation, scheduledFor: number): { count: number; firstMs: number } | null {
  const armedAt = Date.parse(automation.nextRunAt)
  if (!Number.isFinite(armedAt) || armedAt >= scheduledFor) return null
  const count = countCronBetween(automation.schedule, armedAt, scheduledFor)
  return count > 0 ? { count, firstMs: armedAt } : null
}

/**
 * Execute one automation now, recording exactly one run. Exported for
 * `automation.runNow` (manual trigger), which skips the precheck: the user
 * asking for it IS the answer to "is this worth running".
 */
export async function runAutomationOnce(
  deps: RunnerDeps,
  automation: Automation,
  args: { scheduledFor: number; trigger: "scheduled" | "manual" },
): Promise<AutomationRunStatus> {
  const now = deps.now ?? Date.now
  const record = async (
    status: AutomationRunStatus,
    extra: {
      taskId?: string
      tabId?: string
      deferredId?: string
      error?: string
      precheckResult?: Awaited<ReturnType<typeof runAutomationPrecheck>>
    } = {},
  ): Promise<AutomationRunStatus> => {
    await deps.store.recordRun({
      automationId: automation.id,
      scheduledFor: new Date(args.scheduledFor).toISOString(),
      status,
      trigger: args.trigger,
      at: new Date(now()).toISOString(),
      ...extra,
    })
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

  let outcome: Awaited<ReturnType<typeof dispatchAutomation>>
  try {
    outcome = await dispatchAutomation(
      {
        canDeliver: () => !cancelled(),
        orch: deps.orch,
        runtime: deps.runtime,
        link: () => resolveLink(deps.link),
        ...(deps.deferred ? { deferred: deps.deferred } : {}),
        ...(deps.inbox ? { inbox: deps.inbox } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      },
      automation,
    )
  } catch (err) {
    // A repo that moved or was forgotten lands here — the schedule is fine,
    // its target is not, so this is `unavailable` rather than a failure.
    const error = err instanceof Error ? err.message : String(err)
    logDaemonError("automation-dispatch", err)
    return await record("skipped_unavailable", { error })
  }

  // Persist the standing-session link BEFORE recording the run: a crash
  // between the two costs one run record, while the reverse would leave the
  // routine building a second standing task on its next firing.
  if (outcome.sessionTaskIdToSet) {
    await deps.store
      .update(automation.id, { sessionTaskId: outcome.sessionTaskIdToSet })
      .catch((err) => logDaemonError("automation-session-link", err))
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
    ...(outcome.deferredId ? { deferredId: outcome.deferredId } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  })
}

/** One sweep pass. Exported so tests can drive it without a timer.
 *  `tickMs` is the runner's own cadence, which sets the grace floor — see
 *  {@link resolveDueOccurrence}. */
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

    // One row for every occurrence between the armed time and the one being
    // run — recorded whatever happens next, because a routine that quietly
    // became four-hourly and one that ran every minute must not read the same.
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

/**
 * Start the sweep. `tickMs: 0` disables it entirely — the test harness boots a
 * daemon with every collector zeroed, and this must honour that too.
 */
export function startAutomationRunner(
  deps: RunnerDeps,
  tickMs: number = DEFAULT_AUTOMATION_TICK_MS,
): ReturnType<typeof startTicker> {
  // Ungated for the same reason as quota-resume, only more so: a schedule
  // that requires an audience is not a schedule.
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
