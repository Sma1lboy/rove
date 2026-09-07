/**
 * `watch` — block until a task's engine reaches a state, instead of polling
 * for it.
 *
 * The gap is a dispatcher one. Every other read here is a snapshot, so an
 * agent supervising ten workers had exactly one shape available: call
 * `collect`, sleep, call it again. That costs a process spawn and a socket
 * per tick, and it is wrong in both directions — too slow and the news is
 * stale (an engine killed with SIGKILL went unnoticed for a full poll
 * interval), too fast and the fleet spends its time answering the watcher.
 *
 * The daemon already publishes exactly this: `engine-state` carries every
 * activity transition it knows, INCLUDING `dead`, which it writes from the
 * pty-host exit record rather than from a hook (a killed engine fires no
 * hook — that is the whole reason the state exists). So this verb is a
 * subscription with a filter and an exit condition, deliberately not a
 * general event bus: one channel, one predicate, one process that ends.
 *
 * Output is a STREAM: one NDJSON line per transition on stdout, then the
 * usual single result object when the watch ends. A caller reading
 * line-by-line acts on the first line; a caller reading the whole output
 * gets both.
 */

import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/**
 * Every state `engine-state` can carry (kobe-daemon's `TaskActivityState`).
 *
 * Spelled out here so a typo in `--until` is refused at the boundary rather
 * than waiting forever for a state that does not exist — the single worst
 * failure mode for a verb whose entire job is to wait.
 */
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

export async function watch(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskIds = new Set(await resolveTaskIds(ctx))
  const until = new Set(parseUntil(ctx.args.require("until")))
  const timeoutRaw = ctx.args.int("timeout")
  const timeoutMs = timeoutRaw && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS

  return await new Promise((resolve, reject) => {
    let settled = false
    let events = 0
    /**
     * Events already emitted, so a repeat of the same (task, tab, state, at)
     * never prints twice — that is one daemon transition, not two.
     *
     * A SET rather than a last-seen key: the registry publishes a transition
     * at tab level and again as the task-level rollup, and the two interleave
     * (`tab-1 running` / `running` / `tab-1 running` for a single turn start),
     * so comparing only against the previous line lets the third through.
     * Bounded because a long watch on a busy fleet would otherwise grow
     * without limit; the cap is far above any plausible burst.
     */
    const seen = new Set<string>()
    const SEEN_CAP = 512

    // `off` / `deadline` / `heartbeat` are declared below and closed over
    // here: nothing can call this before they exist (every caller is a
    // channel push or a timer, both of which fire after this scope is set up).
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

    // A dead daemon is silence, and silence is indistinguishable from "the
    // engine is still working" — which is exactly the wrong thing for a verb
    // whose answer is a wait. The heartbeat converts it into a named
    // failure the caller can reconnect on. It also catches a socket that is
    // open but wedged, which a close event never reports.
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
