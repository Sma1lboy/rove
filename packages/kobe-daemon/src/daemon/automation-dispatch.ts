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
import type { DaemonRuntimeAdapter } from "./runtime.ts"

/** The orchestrator slice a firing needs. */
export type DispatchOrchestrator = Pick<DaemonOrchestrator, "createTask" | "getTask">

export type DispatchRuntime = Pick<
  DaemonRuntimeAdapter,
  "startTaskSessionWithPrompt" | "deliverPromptToLiveEngineDetailed" | "deliverPromptToLiveEngineTabDetailed"
>

export interface DispatchDeps {
  readonly orch: DispatchOrchestrator
  readonly runtime: DispatchRuntime
  /** Resolved lazily for the same construction-order reason as the runner's. */
  readonly link: () => import("../client/rpc.ts").DaemonRpcClient
  readonly now?: () => number
  readonly canDeliver?: () => boolean
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

/** Create the task a firing runs in, marked as the routine's when standing. */
async function createRunTask(deps: DispatchDeps, automation: Automation): Promise<DaemonTask> {
  return await deps.orch.createTask({
    repo: automation.repo,
    title: automation.name,
    ...(automation.vendor ? { vendor: automation.vendor } : {}),
    ...(automation.baseRef ? { baseRef: automation.baseRef } : {}),
    // Folds the task behind the sidebar's routine row. Standing only: fresh
    // runs are work the user must land.
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

/** Run one firing until an engine has the prompt. Scheduling and run-recording are the runner's. */
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
    // Build and remember a session, clearing any stale link.
    const task = await createRunTask(deps, automation)
    const outcome = await spawnWithPrompt(deps, automation, task.id, "dispatched")
    return {
      ...outcome,
      // Even if the engine failed: the worktree exists, so the next firing
      // revives THAT session instead of stacking a second one.
      sessionTaskIdToSet: task.id,
      ...(standing.hadStaleLink ? { sessionTaskIdToClear: true } : {}),
    }
  }

  const task = standing.task
  const result = await deps.runtime.deliverPromptToLiveEngineDetailed(
    { id: task.id, vendor: task.vendor, command: task.command, worktreePath: task.worktreePath },
    automation.prompt,
  )
  if (result.outcome === "delivered") {
    return await liveDeliveryOutcome(deps, automation, task.id, result)
  }
  // `no-session` (tab gone) and `no-engine` (keepAlive left a login shell):
  // the engine died between firings. Respawn in the SAME worktree as
  // `revived`. `no-engine` must land here, or the prompt gets typed into zsh
  // and RUN as shell commands.
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
