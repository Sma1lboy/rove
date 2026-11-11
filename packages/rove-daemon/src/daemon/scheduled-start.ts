/**
 * One-shot delayed starts. A pending start (`pending-starts-store.ts`, the web's "Later") creates its task,
 * engine and prompt when due; nothing exists before then. A task that already carries `Task.scheduledStart`
 * (written by older builds, or `task.scheduleStart` on an existing task) has its engine started instead.
 * Times are absolute on-disk timestamps, never in-memory timers, so a restart needs no re-arm pass and a
 * start that came due while the daemon was down runs on its first tick (same shape as `quota-resume.ts`).
 */

import type { ApiEnvelope, ApiParams } from "@sma1lboy/rove-plugin-sdk/contract"
import type { DaemonRpcClient } from "../client/rpc.ts"
import type { DaemonOrchestrator, DaemonTask } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import type { PendingStart, PendingStartsStore } from "./pending-starts-store.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

export const DEFAULT_SCHEDULED_START_TICK_MS = 15_000

export interface ScheduledStartDeps {
  readonly orch: Pick<
    DaemonOrchestrator,
    "listTasks" | "getTask" | "setScheduledStart" | "setPrompt" | "ensureMainTask" | "openDirectoryTask"
  >
  readonly runtime: Pick<DaemonRuntimeAdapter, "startTaskSessionWithPrompt">
  readonly link: DaemonRpcClient | (() => DaemonRpcClient)
  /** Absent in tests that only exercise task-carried schedules. */
  readonly pending?: PendingStartsStore
  /** Runs a `rove api` verb in this daemon (the `add` a pending start was recorded as). */
  readonly invoke?: (verb: string, params: ApiParams) => Promise<ApiEnvelope>
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

/**
 * Create a pending start's task with its engine and prompt. Removed BEFORE it runs, so an overlapping tick
 * can't create it twice; a failure puts it back with the error and it is not tried again.
 */
export async function firePendingStart(deps: ScheduledStartDeps, start: PendingStart): Promise<ScheduledStartOutcome> {
  if (!deps.pending || !(await deps.pending.remove(start.id))) return "dropped"
  const error = await createPendingStart(deps, start).catch((err: unknown) =>
    err instanceof Error ? err.message : String(err),
  )
  logDaemonInfo("scheduled-start", `pending start=${start.id} ${error ? `failed: ${error}` : "started"}`)
  if (!error) return "started"
  await deps.pending.fail(start, error)
  return "failed"
}

/** The failure, in words; undefined when the task and its engine are up with the prompt. */
async function createPendingStart(deps: ScheduledStartDeps, start: PendingStart): Promise<string | undefined> {
  const { create } = start
  if (create.via === "add") {
    if (!deps.invoke) return "this daemon cannot run verbs"
    const envelope = await deps.invoke("add", { ...create.params, prompt: start.prompt })
    return envelope.ok ? undefined : `${envelope.error.code}: ${envelope.error.message}`
  }
  const dir = create.project ? (await deps.orch.ensureMainTask(create.dir)).repo : create.dir
  const task = await deps.orch.openDirectoryTask({
    dir,
    ...(create.vendor ? { vendor: create.vendor as DaemonTask["vendor"] } : {}),
    ...(start.title ? { title: start.title } : {}),
  })
  await deps.orch.setPrompt(task.id, start.prompt)
  const link = typeof deps.link === "function" ? deps.link() : deps.link
  const outcome = await deps.runtime.startTaskSessionWithPrompt(link, task.id, start.prompt)
  return outcome.started ? undefined : (outcome.error ?? "engine session did not start")
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
      for (const start of deps.pending?.due(now()) ?? []) {
        await firePendingStart(deps, start).catch((err) => logDaemonError("scheduled-start", err))
      }
    },
  })
}
