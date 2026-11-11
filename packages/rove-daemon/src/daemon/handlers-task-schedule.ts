/**
 * `task.scheduleStart` / `task.cancelScheduledStart` / `task.startScheduledNow`: the one-shot delayed start
 * of an unstarted task (`scheduled-start.ts` owns the clock). Scheduling never starts anything.
 */

import { requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { startScheduledNow } from "./scheduled-start.ts"

/** Longest first message accepted, in characters. */
const PROMPT_MAX = 20_000

/** `{at, prompt}` checked and normalized, for `task.scheduleStart` and a `task.create` that carries its schedule. */
export function parseScheduledStart(raw: unknown): { at: string; prompt: string } {
  const payload = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  const at = requireString(payload, "at")
  const prompt = requireString(payload, "prompt")
  if (prompt.length > PROMPT_MAX) throw new Error(`prompt is longer than ${PROMPT_MAX} characters`)
  const when = Date.parse(at)
  if (!Number.isFinite(when)) throw new Error("at must be an ISO-8601 time")
  return { at: new Date(when).toISOString(), prompt }
}

export const SCHEDULE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.scheduleStart",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const schedule = parseScheduledStart(payload)
      const task = ctx.orch.getTask(taskId)
      if (!task) throw new Error(`task not found: ${taskId}`)
      if (task.prompt) throw new Error("ALREADY_STARTED: this task already has its first message")
      await ctx.orch.setScheduledStart(taskId, schedule)
      return { taskId, at: schedule.at }
    },
  },
  {
    name: "task.cancelScheduledStart",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      await ctx.orch.setScheduledStart(taskId, null)
      return {}
    },
  },
  {
    name: "task.startScheduledNow",
    blocking: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      if (!ctx.orch.getTask(taskId)?.scheduledStart) throw new Error("NOT_SCHEDULED: this task has no scheduled start")
      const outcome = await startScheduledNow({ orch: ctx.orch, runtime: ctx.runtime, link: ctx.selfLink }, taskId)
      return { outcome }
    },
  },
]
