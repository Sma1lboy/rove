/**
 * `pendingStart.*`: a start that creates its task when due ("Later"). `task.scheduleStart` /
 * `task.cancelScheduledStart` / `task.startScheduledNow`: the delayed start of a task that already exists.
 * `scheduled-start.ts` owns the clock for both; scheduling never starts anything.
 */

import type { ApiParams } from "@sma1lboy/rove-plugin-sdk/contract"
import { optionalBoolean, optionalString, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import type { PendingStartCreate, PendingStartsStore } from "./pending-starts-store.ts"
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

/** What a pending start creates: `add` flags (never a prompt, which the start carries) or a directory session. */
function parseCreate(raw: unknown): PendingStartCreate {
  const create = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  if (create.via === "dir") {
    const vendor = optionalString(create, "vendor")
    return {
      via: "dir",
      dir: requireString(create, "dir"),
      project: optionalBoolean(create, "project") === true,
      ...(vendor ? { vendor } : {}),
    }
  }
  if (create.via !== "add") throw new Error("create.via must be add or dir")
  const params = create.params
  if (typeof params !== "object" || params === null || Array.isArray(params))
    throw new Error("create.params must be an object")
  const flags = params as Record<string, unknown>
  for (const [flag, value] of Object.entries(flags)) {
    const scalar = typeof value === "string" || typeof value === "boolean" || typeof value === "number"
    if (!scalar && !(Array.isArray(value) && value.every((v) => typeof v === "string")))
      throw new Error(`create.params.${flag} must be a string, number, boolean or string list`)
  }
  // The start delivers its own prompt; anything that would run something else now is not a pending start.
  const runsNow = ["prompt", "prompt-file", "start", "worktree-only", "count", "agents"].find((f) => f in flags)
  if (runsNow) throw new Error(`create.params.${runsNow} does not belong in a pending start`)
  return { via: "add", params: flags as ApiParams }
}

function pendingOf(ctx: { readonly pendingStarts?: PendingStartsStore }): PendingStartsStore {
  if (!ctx.pendingStarts) throw new Error("this daemon keeps no pending starts")
  return ctx.pendingStarts
}

export const SCHEDULE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "pendingStart.add",
    async handle(payload, ctx) {
      const { at, prompt } = parseScheduledStart(payload)
      const create = parseCreate(payload.create)
      const title = (optionalString(payload, "title") ?? "").slice(0, 200)
      const start = await pendingOf(ctx).add({ at, prompt, title, repo: requireString(payload, "repo"), create })
      return { id: start.id, at: start.at }
    },
  },
  {
    name: "pendingStart.list",
    async handle(_payload, ctx) {
      return { starts: ctx.pendingStarts?.list() ?? [] }
    },
  },
  {
    name: "pendingStart.cancel",
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      if (!(await pendingOf(ctx).remove(id))) throw new Error(`NOT_SCHEDULED: no pending start ${id}`)
      return {}
    },
  },
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
