/**
 * How ONE automation firing reaches an engine.
 *
 * Its own module along a real seam: the runner owns WHEN a schedule fires,
 * this owns WHERE the prompt lands. That is also what makes the four delivery
 * paths below testable without a clock — none of them needs to know a schedule
 * exists.
 *
 * Three targets, resolved by `automationTarget`:
 *
 *  - **Fresh** (default): create a task, spawn its engine with the prompt on
 *    the argv. One worktree and one
 *    branch per firing — what a routine that EDITS code needs, since a week of
 *    runs piled onto one branch is a branch nobody can land.
 *
 *  - **Standing**: create the task once, then re-deliver into it every firing.
 *    An inspection routine ("is CI worse than yesterday?") is worthless
 *    without the previous answer in the same transcript.
 *
 *  - **Existing tab**: deliver only to a user-owned task and exact tab. Missing
 *    targets fail; the routine never creates or revives them.
 *
 * ## What "continuity" actually rests on
 *
 * The engine's own conversation, kept alive by the PTY host — which lives
 * OUTSIDE the daemon on purpose (`pty-server.ts`), so it survives
 * `rove daemon restart` and every sweep in between. While that PTY is alive,
 * a firing is another turn in one conversation.
 *
 * When it is NOT alive, the standing task is revived by spawning a fresh
 * engine in the same worktree. That engine does NOT inherit the transcript:
 * the daemon's spawn path (`buildEngineSessionLaunch`) has no resume verb
 * wired into it — `engineResumeArgv` is the TUI's tab-restart path, not this
 * one. The worktree and its files carry over; the conversation does not. That
 * is recorded as `revived` on the run rather than reported as a plain
 * `dispatched`, because "it answered with yesterday in mind" and "it started
 * over" must not look identical in the run history.
 *
 * ## Why composer-busy cannot be dropped here
 *
 * `quota-resume` drops a blocked prompt on purpose — it is a nudge, and the
 * next rate-limit arms a new one. A routine's report has no such second
 * chance: dropped, it is indistinguishable from a routine that never ran. So
 * a busy composer tries to file a deferral and Inbox episode. Acceptance is
 * recorded as `deferred`; an occupied slot preserves its earlier prompt and
 * records this run as `dispatch_failed`.
 */

import { assertAutomationTargetTask, automationTarget } from "./automation-target.ts"
import type { Automation, AutomationRunStatus, DaemonOrchestrator, DaemonTask } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import {
  DEFERRED_PROMPT_TTL_MS,
  DeferredPromptPendingError,
  type DeferredPromptRecord,
  type DeferredPromptsStore,
} from "./deferred-prompts-store.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

/** The orchestrator slice a firing needs. */
export type DispatchOrchestrator = Pick<DaemonOrchestrator, "createTask" | "getTask">

export type DispatchRuntime = Pick<
  DaemonRuntimeAdapter,
  "startTaskSessionWithPrompt" | "deliverPromptToLiveEngineDetailed" | "deliverPromptToLiveEngineTabDetailed"
>

/** The Inbox slice a deferral needs (`attention-inbox.ts`). */
export interface DispatchInbox {
  recordPromptDeferred(
    taskId: string,
    tabId: string,
    deferredId: string,
    layer: "recent-human-write" | "composer-not-empty",
    expiresAt?: number,
  ): Promise<void>
}

export interface DispatchDeps {
  readonly orch: DispatchOrchestrator
  readonly runtime: DispatchRuntime
  /** Resolved lazily for the same construction-order reason as the runner's. */
  readonly link: () => import("../client/rpc.ts").DaemonRpcClient
  /** Absent in a daemon booted without one; a busy composer then falls back
   *  to reporting the failure rather than silently dropping the report. */
  readonly deferred?: DeferredPromptsStore
  readonly inbox?: DispatchInbox
  readonly now?: () => number
  readonly canDeliver?: () => boolean
}

/**
 * Outcome of one firing. `taskId` is carried even on failure: the task may
 * exist while its engine did not start, and the run record is the only place
 * that id survives for a human to open by hand.
 */
export interface DispatchOutcome {
  readonly status: AutomationRunStatus
  readonly taskId?: string
  readonly tabId?: string
  readonly deferredId?: string
  readonly error?: string
  /** Set when the standing session was rebuilt — see `clearSessionTaskId`. */
  readonly sessionTaskIdToClear?: boolean
  /** Set on the firing that established a standing session. */
  readonly sessionTaskIdToSet?: string
}

/**
 * The standing task this automation should deliver into, or null when it must
 * be (re)built.
 *
 * A task that was deleted, is BEING deleted, or lost its worktree is not a
 * session — returning null here is what stops one deleted task from wedging a
 * routine into failing forever, which is the failure mode a bare stored id
 * would otherwise have.
 */
export function resolveStandingTask(
  orch: DispatchOrchestrator,
  automation: Automation,
): { task: DaemonTask } | { task: null; hadStaleLink: boolean } {
  const id = automation.sessionTaskId
  if (!id) return { task: null, hadStaleLink: false }
  const task = orch.getTask(id)
  if (!task || task.deletion || !task.worktreePath) return { task: null, hadStaleLink: true }
  return { task }
}

/** Create the task a firing runs in, marked as the routine's when standing. */
async function createRunTask(deps: DispatchDeps, automation: Automation): Promise<DaemonTask> {
  return await deps.orch.createTask({
    repo: automation.repo,
    title: automation.name,
    ...(automation.vendor ? { vendor: automation.vendor } : {}),
    ...(automation.baseRef ? { baseRef: automation.baseRef } : {}),
    // The marker is what folds this task behind the sidebar's routine count
    // row. Only standing sessions get it: a fresh-per-run routine produces
    // ordinary tasks, and hiding those would hide work the user must land.
    ...(automation.persistentSession ? { routine: { automationId: automation.id } } : {}),
  })
}

/** Spawn a task's engine with the prompt on its argv. Shared by both shapes. */
async function spawnWithPrompt(
  deps: DispatchDeps,
  automation: Automation,
  taskId: string,
  status: AutomationRunStatus,
): Promise<DispatchOutcome> {
  if (deps.canDeliver?.() === false) return { status: "skipped_cancelled", taskId }
  const outcome = await deps.runtime.startTaskSessionWithPrompt(deps.link(), taskId, automation.prompt)
  if (!outcome.started) {
    return { status: "dispatch_failed", taskId, error: outcome.error ?? "engine session did not start" }
  }
  return { status, taskId }
}

/**
 * File a blocked prompt for a human to release from the Inbox. Returns the
 * outcome to record — `deferred` when the daemon took ownership of the text,
 * and a failure when it could not, so a report is never lost quietly.
 */
async function deferBlockedPrompt(
  deps: DispatchDeps,
  automation: Automation,
  taskId: string,
  tabId: string,
  layer: "recent-human-write" | "composer-not-empty",
): Promise<DispatchOutcome> {
  if (!deps.deferred || !deps.inbox) {
    return { status: "dispatch_failed", taskId, error: `composer busy (${layer}) and no deferred-prompt store` }
  }
  let record: DeferredPromptRecord
  try {
    record = await deps.deferred.file({
      taskId,
      tabId,
      prompt: automation.prompt,
      layer,
      senderLabel: `routine: ${automation.name}`,
      at: (deps.now ?? Date.now)(),
    })
  } catch (error) {
    if (!(error instanceof DeferredPromptPendingError)) throw error
    // A previous firing may have committed the record and crashed before its
    // Inbox pointer. Recreate that pointer before reporting the occupied slot.
    await deps.inbox.recordPromptDeferred(
      error.existing.taskId,
      error.existing.tabId,
      error.existing.id,
      error.existing.layer,
      // The RECORD's own deadline, not this pointer's: the text has been held
      // since the earlier filing and the sweep counts from then.
      error.existing.at + DEFERRED_PROMPT_TTL_MS,
    )
    return {
      status: "dispatch_failed",
      taskId,
      error: `tab ${tabId} already has a deferred prompt (${error.existing.id})`,
    }
  }
  let notificationError: string | undefined
  await deps.inbox
    .recordPromptDeferred(taskId, tabId, record.id, layer, record.at + DEFERRED_PROMPT_TTL_MS)
    .catch((error: unknown) => {
      logDaemonError("automation-deferred-inbox", error)
      notificationError = `prompt queued; Inbox notification failed: ${String(error)}`
    })
  logDaemonInfo("automation", `deferred ${automation.name} task=${taskId} tab=${tabId} layer=${layer}`)
  return {
    status: "deferred",
    taskId,
    tabId,
    deferredId: record.id,
    ...(notificationError ? { error: notificationError } : {}),
  }
}

/**
 * Run one firing to the point where an engine has the prompt (or a human owns
 * it). Pure of scheduling and of run-recording — the runner does both.
 */
export async function dispatchAutomation(deps: DispatchDeps, automation: Automation): Promise<DispatchOutcome> {
  if (deps.canDeliver?.() === false) return { status: "skipped_cancelled" }
  const target = automationTarget(automation)
  if (target.kind === "existing-tab") {
    try {
      await assertAutomationTargetTask(automation, deps.orch)
    } catch (error) {
      return { status: "skipped_unavailable", taskId: target.taskId, tabId: target.tabId, error: String(error) }
    }
    const task = deps.orch.getTask(target.taskId)
    if (!task || task.deletion || !task.worktreePath) {
      return {
        status: "skipped_unavailable",
        taskId: target.taskId,
        tabId: target.tabId,
        error: "target task unavailable",
      }
    }
    if (deps.canDeliver?.() === false) return { status: "skipped_cancelled", taskId: task.id, tabId: target.tabId }
    const pending = (await deps.deferred?.listForTask(task.id))?.find((record) => record.tabId === target.tabId)
    if (pending)
      return {
        status: "dispatch_failed",
        taskId: task.id,
        tabId: target.tabId,
        error: `tab ${target.tabId} already has a deferred prompt (${pending.id})`,
      }
    if (deps.canDeliver?.() === false) return { status: "skipped_cancelled", taskId: task.id, tabId: target.tabId }
    const currentTask = deps.orch.getTask(task.id)
    if (!currentTask || currentTask.deletion || !currentTask.worktreePath) {
      return { status: "skipped_unavailable", taskId: task.id, tabId: target.tabId, error: "target task unavailable" }
    }
    const result = await deps.runtime.deliverPromptToLiveEngineTabDetailed(
      { id: task.id, tabId: target.tabId, vendor: task.vendor, command: task.command, worktreePath: task.worktreePath },
      automation.prompt,
    )
    return await liveDeliveryOutcome(deps, automation, task.id, result)
  }
  if (target.kind === "fresh") {
    const task = await createRunTask(deps, automation)
    return await spawnWithPrompt(deps, automation, task.id, "dispatched")
  }

  const standing = resolveStandingTask(deps.orch, automation)
  if (standing.task === null) {
    // No session yet, or the one we had is gone. Build one and remember it —
    // clearing the stale link in the same breath, so a deleted task cannot
    // strand this routine on an id that will never resolve again.
    const task = await createRunTask(deps, automation)
    const outcome = await spawnWithPrompt(deps, automation, task.id, "dispatched")
    return {
      ...outcome,
      // Remember the task even when its engine failed to start: the worktree
      // exists, and the next firing should revive THAT session rather than
      // stack a second standing task beside it.
      sessionTaskIdToSet: task.id,
      ...(standing.hadStaleLink ? { sessionTaskIdToClear: true } : {}),
    }
  }

  const task = standing.task
  const result = await deps.runtime.deliverPromptToLiveEngineDetailed(
    { id: task.id, vendor: task.vendor, command: task.command, worktreePath: task.worktreePath },
    automation.prompt,
  )
  if (result.outcome === "delivered" || result.outcome === "busy") {
    return await liveDeliveryOutcome(deps, automation, task.id, result)
  }
  // `no-session` (the tab is gone) and `no-engine` (the tab is alive but
  // keepAlive left a login shell where the engine exited) both land here: the
  // engine died between firings, an overnight gap being the normal case.
  // Respawn it in the SAME worktree: the files carry over, the transcript
  // does not — recorded as `revived` so the run history says which it was.
  // `no-engine` reaching this branch is what stops a daily prompt from being
  // typed at a zsh prompt and RUN as shell commands while the run records
  // `dispatched`.
  return await spawnWithPrompt(deps, automation, task.id, "revived")
}

async function liveDeliveryOutcome(
  deps: DispatchDeps,
  automation: Automation,
  taskId: string,
  result: Awaited<ReturnType<DispatchRuntime["deliverPromptToLiveEngineTabDetailed"]>>,
): Promise<DispatchOutcome> {
  switch (result.outcome) {
    case "delivered":
      logDaemonInfo("automation", `delivered ${automation.name} task=${taskId} tab=${result.tabId}`)
      return { status: "dispatched", taskId, tabId: result.tabId }
    case "busy":
      return await deferBlockedPrompt(deps, automation, taskId, result.tabId, result.layer)
    case "no-engine":
    case "no-session":
      return {
        status: "dispatch_failed",
        taskId,
        tabId: automation.target?.tabId,
        error:
          result.outcome === "no-engine"
            ? "target engine exited; restart it explicitly"
            : "target tab has no live session",
      }
  }
}
