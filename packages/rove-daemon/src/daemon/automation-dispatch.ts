/**
 * WHERE one automation firing's prompt lands; the runner owns WHEN. So these
 * paths are testable without a clock. Targets (`automationTarget`):
 *
 *  - **Fresh** (default): new task, prompt on the engine argv. One worktree +
 *    branch per firing — a week of code-editing runs on one branch can't land.
 *  - **Standing**: create once, re-deliver every firing; an inspection routine
 *    needs the previous answer in the same transcript.
 *  - **Existing tab**: only a user-owned task + exact tab. Missing targets
 *    fail; never created or revived.
 *
 * ## Continuity
 *
 * Rests on the engine conversation in the PTY host, which lives OUTSIDE the
 * daemon (`pty-server.ts`) and survives `rove daemon restart`. When that PTY
 * is gone, a standing task is revived with a fresh engine in the same
 * worktree — files carry over, the transcript does NOT (`buildEngineSessionLaunch`
 * has no resume verb; `engineResumeArgv` is the TUI's path). Recorded as
 * `revived`, not `dispatched`, so run history tells the two apart.
 */

import { assertAutomationTargetTask, automationTarget } from "./automation-target.ts"
import type { Automation, AutomationRunStatus, DaemonOrchestrator, DaemonTask } from "./contracts.ts"
import { logDaemonInfo } from "./crash-log.ts"
import { type GateLedger, carryOwedGateAnswers } from "./gate-handoff.ts"
import { ptyScopeFor } from "./pty-alias.ts"
import type { RunnabilityVerdict, SkipReason, SkipVerdict } from "./runnability-contracts.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

/** The orchestrator slice a firing needs. */
export type DispatchOrchestrator = Pick<DaemonOrchestrator, "createTask" | "getTask"> &
  Partial<Pick<DaemonOrchestrator, "listTasks">>

export type DispatchRuntime = Pick<
  DaemonRuntimeAdapter,
  "startTaskSessionWithPrompt" | "deliverPromptToLiveEngineDetailed" | "deliverPromptToLiveEngineTabDetailed"
>

/** Should-run, as a firing sees it. Absent for a manual run, which bypasses it like the precheck. */
export interface DispatchRunnability {
  check(taskId: string, tabId: string | null, ignore?: readonly SkipReason[]): RunnabilityVerdict
  /**
   * Vendor quota for a firing that creates a task, from the cached usage
   * snapshot only (no fetch): an unknown quota is no reason to skip. A fresh
   * task has no other prior state.
   */
  freshQuota(vendor: string | undefined): SkipVerdict | undefined
}

export interface DispatchDeps {
  readonly orch: DispatchOrchestrator
  readonly runtime: DispatchRuntime
  /** Resolved lazily for the same construction-order reason as the runner's. */
  readonly link: () => import("../client/rpc.ts").DaemonRpcClient
  readonly now?: () => number
  readonly canDeliver?: () => boolean
  /** Answered decision gates owed to the target tab ride the prompt (design § 3). */
  readonly gates?: GateLedger
  readonly runnability?: DispatchRunnability
}

/** `taskId` survives failure too: the task may exist without an engine, and the run record is the only place a human finds it. */
export interface DispatchOutcome {
  readonly status: AutomationRunStatus
  readonly taskId?: string
  readonly tabId?: string
  readonly error?: string
  /** Set when the standing session was rebuilt — see `clearSessionTaskId`. */
  readonly sessionTaskIdToClear?: boolean
  /** Set on the firing that established a standing session. */
  readonly sessionTaskIdToSet?: string
  /** Set with `skipped_blocked`, and with `dispatch_failed` when the refusal needs a human. */
  readonly blocked?: SkipVerdict
}

/**
 * The standing task to deliver into, or null to (re)build. A deleted,
 * being-deleted, or worktree-less task is null, so a deleted task can't wedge
 * the routine into failing forever.
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

/**
 * A refusal whose cause needs a human and has no Inbox row of its own: a skip would stay muted and
 * hide a dead or errored bound tab, so it is a failure (the `routine_failed` alarm) that keeps `blocked`.
 */
const ALARMING_REFUSALS: Partial<Record<SkipReason, true>> = { "engine-dead": true, "engine-error": true }

/** The outcome for a refusing verdict (`dispatch_failed` if it needs a human); undefined when the firing may go ahead. */
function blockedOutcome(
  verdict: RunnabilityVerdict | SkipVerdict | undefined,
  where: { taskId?: string; tabId?: string },
): DispatchOutcome | undefined {
  if (!verdict || verdict.run) return undefined
  // `error` is the text the Routines row prints beside the status.
  const error = `${verdict.reason}${verdict.detail ? `: ${verdict.detail}` : ""}${verdict.until ? ` (until ${verdict.until})` : ""}`
  const status = ALARMING_REFUSALS[verdict.reason] ? "dispatch_failed" : "skipped_blocked"
  return { status, ...where, blocked: verdict, error }
}

/** Create the task a firing runs in, marked as the routine's when standing. */
async function createRunTask(deps: DispatchDeps, automation: Automation): Promise<DaemonTask> {
  return await deps.orch.createTask({
    repo: automation.repo,
    title: automation.name,
    ...(automation.vendor ? { vendor: automation.vendor } : {}),
    ...(automation.model ? { model: automation.model } : {}),
    ...(automation.modelEffort ? { modelEffort: automation.modelEffort } : {}),
    ...(automation.baseRef ? { baseRef: automation.baseRef } : {}),
    // Folds the task behind the sidebar's routine row. Standing only: fresh
    // runs are work the user must land.
    ...(automation.persistentSession ? { routine: { automationId: automation.id } } : {}),
  })
}

/** Spawn a task's engine with the prompt on its argv. Shared by both shapes. */
async function spawnWithPrompt(
  deps: DispatchDeps,
  prompt: string,
  taskId: string,
  status: AutomationRunStatus,
): Promise<DispatchOutcome> {
  if (deps.canDeliver?.() === false) return { status: "skipped_cancelled", taskId }
  const owed = carryOwedGateAnswers(deps.gates, taskId, null, prompt)
  const outcome = await deps.runtime.startTaskSessionWithPrompt(deps.link(), taskId, owed.prompt)
  if (!outcome.started) {
    return { status: "dispatch_failed", taskId, error: outcome.error ?? "engine session did not start" }
  }
  await owed.commit()
  return { status, taskId }
}

/** The prompt for a firing, built once the task (and tab, when known) it lands
 *  in exists, so a delivery can be armed against it before the paste. */
export type DispatchPrompt = string | ((target: { taskId: string; tabId: string | null }) => Promise<string>)

async function resolvePrompt(prompt: DispatchPrompt, target: { taskId: string; tabId: string | null }) {
  return typeof prompt === "string" ? prompt : await prompt(target)
}

/** Run one firing until an engine has `prompt` (the routine's, run header
 *  included). Scheduling and run-recording are the runner's. */
export async function dispatchAutomation(
  deps: DispatchDeps,
  automation: Automation,
  prompt: DispatchPrompt = automation.prompt,
): Promise<DispatchOutcome> {
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
    const currentTask = deps.orch.getTask(task.id)
    if (!currentTask || currentTask.deletion || !currentTask.worktreePath) {
      return { status: "skipped_unavailable", taskId: task.id, tabId: target.tabId, error: "target task unavailable" }
    }
    const blocked = blockedOutcome(deps.runnability?.check(task.id, target.tabId), {
      taskId: task.id,
      tabId: target.tabId,
    })
    if (blocked) return blocked
    const text = await resolvePrompt(prompt, { taskId: task.id, tabId: target.tabId })
    const owed = carryOwedGateAnswers(deps.gates, task.id, target.tabId, text)
    const result = await deps.runtime.deliverPromptToLiveEngineTabDetailed(
      {
        id: task.id,
        tabId: target.tabId,
        vendor: task.vendor,
        command: task.command,
        worktreePath: task.worktreePath,
        scope: ptyScopeFor(deps.orch.listTasks?.() ?? [], task.id),
      },
      owed.prompt,
    )
    if (result.outcome === "delivered") await owed.commit()
    return await liveDeliveryOutcome(deps, automation, task.id, result)
  }
  if (target.kind === "fresh") {
    const quota = blockedOutcome(deps.runnability?.freshQuota(automation.vendor), {})
    if (quota) return quota
    const task = await createRunTask(deps, automation)
    // A fresh task's first engine tab is always tab-1.
    return await spawnWithPrompt(
      deps,
      await resolvePrompt(prompt, { taskId: task.id, tabId: "tab-1" }),
      task.id,
      "dispatched",
    )
  }

  const standing = resolveStandingTask(deps.orch, automation)
  if (standing.task === null) {
    const quota = blockedOutcome(deps.runnability?.freshQuota(automation.vendor), {})
    if (quota) return quota
    // Build and remember a session, clearing any stale link.
    const task = await createRunTask(deps, automation)
    const outcome = await spawnWithPrompt(
      deps,
      await resolvePrompt(prompt, { taskId: task.id, tabId: "tab-1" }),
      task.id,
      "dispatched",
    )
    return {
      ...outcome,
      // Even if the engine failed: the worktree exists, so the next firing
      // revives THAT session instead of stacking a second one.
      sessionTaskIdToSet: task.id,
      ...(standing.hadStaleLink ? { sessionTaskIdToClear: true } : {}),
    }
  }

  const task = standing.task
  // `engine-dead` is not a skip here: the revive path below respawns it.
  const blocked = blockedOutcome(deps.runnability?.check(task.id, null, ["engine-dead"]), { taskId: task.id })
  if (blocked) return blocked
  // Built once: the live attempt and the respawn below carry the same delivery.
  const text = await resolvePrompt(prompt, { taskId: task.id, tabId: null })
  const owed = carryOwedGateAnswers(deps.gates, task.id, null, text)
  const result = await deps.runtime.deliverPromptToLiveEngineDetailed(
    {
      id: task.id,
      vendor: task.vendor,
      command: task.command,
      worktreePath: task.worktreePath,
      scope: ptyScopeFor(deps.orch.listTasks?.() ?? [], task.id),
    },
    owed.prompt,
  )
  if (result.outcome === "delivered") {
    await owed.commit()
    return await liveDeliveryOutcome(deps, automation, task.id, result)
  }
  // `no-session` (tab gone) and `no-engine` (keepAlive left a login shell):
  // the engine died between firings. Respawn in the SAME worktree as
  // `revived`. `no-engine` must land here, or the prompt gets typed into zsh
  // and RUN as shell commands.
  return await spawnWithPrompt(deps, text, task.id, "revived")
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
