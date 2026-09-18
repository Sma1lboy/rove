/**
 * `context` — the ONE read a coordinating agent runs at the start of every
 * turn, so it works from what the command printed rather than from what it
 * remembers.
 *
 * Composition only: five reads the daemon already answers, folded into one
 * payload. No new state, no new writer, nothing polled that wasn't already
 * being polled. The composition matters because the alternative — `list`,
 * then `get-task` per task, then `inspect`, then `note-list` — is a dozen
 * round trips and a dozen results an agent has to join by hand, every turn.
 *
 * Cost discipline: this is paid for on EVERY coordinator turn, in tokens, so
 * the per-task row carries five facts and a group (see `context-view.ts`) and
 * liveness comes from ONE `pty.list` for the whole fleet instead of
 * `collect`'s per-task `taskTabs` hop.
 */

import type { AttentionInboxItem } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import {
  type ActivityEntry,
  CONTEXT_TASK_LIMIT,
  type ContextNote,
  buildContext,
  renderContext,
} from "./context-view.ts"
import { F } from "./flags.ts"
import { daemonOf, repoFilter } from "./handler-helpers.ts"
import type { VerbContext, VerbSpec } from "./types.ts"

/** A daemon read whose absence must stay distinguishable from "empty". */
async function tryRead<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

async function context(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args, runtime } = ctx
  const repoFlag = args.requireRepo("repo")
  const limit = args.int("limit") ?? CONTEXT_TASK_LIMIT

  const { tasks: allTasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
  // Throws when `--repo` itself does not resolve, and names the task repos it
  // could not: an empty task list beside a non-empty `unresolvableRepos` is a
  // failed lookup, not a quiet project.
  const filter = await repoFilter(
    runtime,
    repoFlag,
    allTasks.map((t) => t.repo),
  )

  // Every task of this repo, before the unit-of-work filter below: an inbox
  // episode about the repo's `main` seat is still this repo's business.
  const repoTaskIds = new Set(allTasks.filter((task) => filter.matches(task.repo)).map((task) => task.id))

  const tasks = allTasks.filter(
    (task) =>
      // Only worktree tasks are units of work. The repo's `main` seat is
      // where the coordinator itself usually sits, and a `dir` entry is a
      // directory somebody opened — neither is anybody's turn.
      (task.kind ?? "task") === "task" &&
      filter.matches(task.repo) &&
      // A worktree already being removed is spent. A deletion that FAILED
      // is not — that one is waiting on a person, and the group says so.
      task.deletion?.phase !== "queued" &&
      task.deletion?.phase !== "running",
  )

  const [inspect, inbox, notes, liveTaskIds] = await Promise.all([
    tryRead(() => daemon.request<{ activity?: { tasks?: Record<string, ActivityEntry> } }>("debug.inspect")),
    tryRead(() => daemon.request<{ items: AttentionInboxItem[] }>("attention.list")),
    tryRead(() => daemon.request<{ notes: ContextNote[] }>("note.list", { repo: filter.target })),
    tryRead(() => runtime.liveTaskIds()),
  ])

  const payload = buildContext({
    repo: filter.target,
    tasks,
    activity: inspect?.activity?.tasks ?? null,
    // `null` = the pty host could not be asked. It must stay distinct from
    // an empty set (a live host owning nothing), which DOES refute a stale
    // `running` claim.
    liveTaskIds: liveTaskIds ?? null,
    // A routine episode (`taskId: null`) has no repo to scope it by — its
    // subject is a schedule, and one firing every minute forever is exactly
    // the failure a repo filter must not hide. Everything else is scoped.
    attention: (inbox?.items ?? []).filter((item) => item.taskId === null || repoTaskIds.has(item.taskId)),
    notes: notes?.notes ?? [],
    now: Date.now(),
    limit,
  })

  if (args.bool("text")) return { text: renderContext(payload) }
  return {
    ...payload,
    ...(filter.unresolvableRepos.length > 0 ? { unresolvableRepos: filter.unresolvableRepos } : {}),
  }
}

export const CONTEXT_VERB: VerbSpec = {
  name: "context",
  group: "read",
  summary:
    "The coordinator's start-of-turn read: one composed snapshot of a repo — every worktree task with its DERIVED group (waiting-on-you|landing|ready-for-review|working|idle|unknown, sorted by rank so the first row is what needs a person next), title, branch, live engine activity + how long, `.checkState` (Rove's own CI truth), the worker's `.report` claim; plus the unhandled attention inbox and the repo's newest field notes (the same ones injected into fresh sessions here). The group is DERIVED from report/PR/activity/liveness — it is not the declared `status`, which a crashed worker leaves lying. `--text` renders it compactly instead of as structured JSON.",
  flags: [
    F.repo(true),
    {
      name: "limit",
      type: "int",
      default: String(CONTEXT_TASK_LIMIT),
      placeholder: "N",
      description: "Max tasks to include. Sorted by rank, so the cap drops the quiet tail; `omittedTasks` reports it.",
    },
    {
      name: "text",
      type: "bool",
      description: "Return { text } — one compact line per task instead of the structured rows.",
    },
  ],
  handler: context,
}
