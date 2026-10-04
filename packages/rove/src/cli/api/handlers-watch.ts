/**
 * `watch` — block until a task's engine reaches a state, instead of polling
 * `collect`. A subscription to `engine-state` (which includes `dead`, written
 * from the pty exit record since a killed engine fires no hook) with a filter
 * and an exit condition — deliberately not a general event bus.
 *
 * Output is a STREAM: one NDJSON line per transition, then the usual single
 * result object when the watch ends.
 */

import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/** Mirrors kobe-daemon's `TaskActivityState`, so an `--until` typo is refused instead of waiting forever. */
const WATCHABLE_STATES = [
  "idle",
  "running",
  "turn_complete",
  "rate_limited",
  "permission_needed",
  "error",
  "dead",
] as const

/** How often the watch proves the daemon is still there. */
const HEARTBEAT_MS = 5_000
const DEFAULT_TIMEOUT_MS = 300_000

interface EngineStateEvent {
  readonly taskId: string
  readonly tabId?: string
  readonly state: string
  readonly at: number
}

async function resolveTaskIds(ctx: VerbContext): Promise<string[]> {
  const ids = ctx.args.str("task-ids")
  const group = ctx.args.str("group")
  if (ids && group) throw new ApiError("pass --task-ids or --group, not both", "BAD_FLAG")
  if (ids) {
    const list = ids
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.length > 0) return list
  }
  if (!group) throw new ApiError("watch needs --task-ids id1,id2 or --group GROUPID", "MISSING_TARGET")
  const { tasks } = await daemonOf(ctx).request<{ tasks: { id: string; groupId?: string }[] }>("task.list")
  const members = tasks.filter((t) => t.groupId === group).map((t) => t.id)
  if (members.length === 0) {
    throw new ApiError(`no tasks in group ${group}`, "TASK_NOT_FOUND", {
      hint: "the groupId is the one `add --count` returned; any surviving sibling's `.groupId` in `list` recovers it",
      nextCommandArgs: ["api", "list"],
    })
  }
  return members
}

function parseUntil(raw: string): string[] {
  const states = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const unknown = states.filter((s) => !(WATCHABLE_STATES as readonly string[]).includes(s))
  if (unknown.length > 0) {
    throw new ApiError(
      `--until names states that do not exist: ${unknown.join(", ")} (valid: ${WATCHABLE_STATES.join(", ")})`,
      "BAD_FLAG",
    )
  }
  if (states.length === 0) throw new ApiError("--until needs at least one state", "BAD_FLAG")
  return states
}

async function watch(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskIds = new Set(await resolveTaskIds(ctx))
  const until = new Set(parseUntil(ctx.args.require("until")))
  const timeoutRaw = ctx.args.int("timeout")
  const timeoutMs = timeoutRaw && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS

  return await new Promise((resolve, reject) => {
    let settled = false
    let events = 0
    /**
     * Dedupes (task, tab, state, at). A SET, not a last-seen key: tab-level
     * and task-rollup publishes interleave (`tab-1 running` / `running` /
     * `tab-1 running`). Capped far above any plausible burst.
     */
    const seen = new Set<string>()
    const SEEN_CAP = 512

    // Closes over `off`/`deadline`/`heartbeat` declared below; every caller fires after setup.
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearInterval(heartbeat)
      clearTimeout(deadline)
      off()
      fn()
    }

    const off = daemon.onChannel("engine-state", (payload) => {
      const event = payload as unknown as EngineStateEvent
      if (!taskIds.has(event.taskId)) return
      const key = `${event.taskId}::${event.tabId ?? ""}::${event.state}::${event.at}`
      if (seen.has(key)) return
      if (seen.size >= SEEN_CAP) seen.clear()
      seen.add(key)
      events++
      process.stdout.write(
        `${JSON.stringify({
          taskId: event.taskId,
          ...(event.tabId ? { tabId: event.tabId } : {}),
          state: event.state,
          at: event.at,
        })}\n`,
      )
      if (!until.has(event.state)) return
      finish(() =>
        resolve({
          ok: true,
          watched: [...taskIds],
          until: [...until],
          events,
          matched: { taskId: event.taskId, ...(event.tabId ? { tabId: event.tabId } : {}), state: event.state },
        }),
      )
    })

    const deadline = setTimeout(() => {
      finish(() =>
        reject(
          new ApiError(`no watched task reached ${[...until].join("/")} within ${timeoutMs}ms`, "WATCH_TIMEOUT", {
            watched: [...taskIds],
            until: [...until],
            events,
            hint: "the state may simply not have happened yet — `collect --task-ids` shows where each task is right now",
            nextCommandArgs: ["api", "collect", "--task-ids", [...taskIds].join(",")],
          }),
        ),
      )
    }, timeoutMs)

    // A dead daemon is silence, indistinguishable from "still working". The
    // heartbeat names it — including an open-but-wedged socket no close event reports.
    const heartbeat = setInterval(() => {
      daemon.request("daemon.status").catch(() => {
        finish(() =>
          reject(
            new ApiError("the daemon went away while watching", "DAEMON_GONE", {
              watched: [...taskIds],
              events,
              hint: "the watch is over and nothing was missed on purpose — re-run it once the daemon is back",
              nextCommandArgs: ["daemon", "status"],
            }),
          ),
        )
      })
    }, HEARTBEAT_MS)

    daemon.subscribe({ channels: ["engine-state"] }).catch((err: unknown) => {
      finish(() => reject(err))
    })
  })
}

export const WATCH_VERB: VerbSpec = {
  name: "watch",
  group: "read",
  summary:
    "Block until a watched task's engine reaches one of --until's states, streaming every transition as NDJSON on the way — the push-driven replacement for a `collect` polling loop. Each line is { taskId, tabId?, state, at }; the usual single result object follows when the watch ends. Exits 0 on a match (with `matched`), WATCH_TIMEOUT when --timeout elapses first, DAEMON_GONE when the daemon dies mid-watch (reconnect and re-run — this verb never reconnects on its own). `dead` is watchable and is the one state polling is worst at: a SIGKILLed engine fires no hook, so the daemon writes it from the pty exit record and pushes it here immediately.",
  flags: [
    { name: "task-ids", type: "csv", placeholder: "a,b,c", description: "Comma-separated task ids to watch." },
    {
      name: "group",
      type: "string",
      placeholder: "GROUPID",
      description: "Watch every task of one fan-out round (the `groupId` that `add --count` returns).",
    },
    {
      name: "until",
      type: "string",
      required: true,
      placeholder: "STATE[,STATE]",
      description: `Stop at the first of these engine states: ${WATCHABLE_STATES.join(", ")}. A state that does not exist is refused up front — a typo would otherwise wait forever.`,
    },
    {
      name: "timeout",
      type: "int",
      placeholder: "MS",
      description: `Give up after this many milliseconds (default ${DEFAULT_TIMEOUT_MS}). Timing out is WATCH_TIMEOUT, exit non-zero — it says nothing happened, never that nothing will.`,
    },
  ],
  handler: watch,
}
