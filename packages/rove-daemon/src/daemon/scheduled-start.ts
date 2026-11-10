/**
 * One-shot delayed start of an unstarted task: `Task.scheduledStart` holds the time and the first message,
 * and a ticker starts the engine when it is due. The time is an absolute on-disk timestamp, never an
 * in-memory timer, so a restart needs no re-arm pass and a schedule that came due while the daemon was
 * down starts on its first tick (same shape as `quota-resume.ts`).
 */

import type { DaemonRpcClient } from "../client/rpc.ts"
import type { DaemonOrchestrator, DaemonTask } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

export const DEFAULT_SCHEDULED_START_TICK_MS = 15_000

export interface ScheduledStartDeps {
  readonly orch: Pick<DaemonOrchestrator, "listTasks" | "getTask" | "setScheduledStart" | "setPrompt">
  readonly runtime: Pick<DaemonRuntimeAdapter, "startTaskSessionWithPrompt">
  readonly link: DaemonRpcClient | (() => DaemonRpcClient)
}

/** Tasks whose armed start is due at `nowMs`. An unparseable time counts as due, so it is cleared rather than stuck. */
export function dueScheduledStarts(tasks: readonly DaemonTask[], nowMs: number): DaemonTask[] {
  return tasks.filter((task) => {
    if (!task.scheduledStart || task.deletion) return false
    const at = Date.parse(task.scheduledStart.at)
    return !Number.isFinite(at) || at <= nowMs
  })
}

export type ScheduledStartOutcome = "started" | "failed" | "dropped"

/**
 * Starts the engine of `taskId` with its scheduled message now, whatever the clock says.
 *
 * Cleared BEFORE the start, so an overlapping tick or a Start-now click can't launch it twice. A task someone
 * already started by hand (it has a stored brief) or that is being deleted drops the schedule untouched.
 * A failed start is logged and not re-armed: the task stays, unstarted, for the owner to retry.
 */
export async function startScheduledNow(deps: ScheduledStartDeps, taskId: string): Promise<ScheduledStartOutcome> {
  const task = deps.orch.getTask(taskId)
  const schedule = task?.scheduledStart
  if (!task || !schedule) return "dropped"
  await deps.orch.setScheduledStart(taskId, null)
  if (task.deletion || task.prompt) {
    logDaemonInfo("scheduled-start", `dropped task=${taskId} (${task.deletion ? "being deleted" : "already started"})`)
    return "dropped"
  }
  await deps.orch.setPrompt(taskId, schedule.prompt)
  const link = typeof deps.link === "function" ? deps.link() : deps.link
  const outcome = await deps.runtime.startTaskSessionWithPrompt(link, taskId, schedule.prompt)
  logDaemonInfo("scheduled-start", `start task=${taskId} started=${outcome.started} ${outcome.error ?? ""}`.trim())
  return outcome.started ? "started" : "failed"
}

/** Stateless per tick, so persisted schedules need no re-arm after restart. */
export function startScheduledStartRunner(
  deps: ScheduledStartDeps,
  tickMs: number = DEFAULT_SCHEDULED_START_TICK_MS,
  now: () => number = Date.now,
): ReturnType<typeof startTicker> {
  // Ungated: an overnight start must not wait for someone to be watching.
  return startTicker({
    name: "scheduled-start",
    tickMs,
    immediate: true,
    run: async () => {
      for (const task of dueScheduledStarts(deps.orch.listTasks(), now())) {
        await startScheduledNow(deps, task.id).catch((err) => logDaemonError("scheduled-start", err))
      }
    },
  })
}
