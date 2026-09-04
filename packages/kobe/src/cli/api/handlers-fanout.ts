/**
 * Verb handlers for `collect` and `feedback` — grouped separately from
 * `handlers-tasks.ts` since they don't touch single-task CRUD. The parallel
 * create path this file is named for lives in `handlers-add.ts`, behind
 * `add --count`.
 */

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { DEFAULT_FEEDBACK_CATEGORY_SLUG, submitFeedback } from "../../lib/feedback.ts"
import { daemonOf, repoFilter } from "./handler-helpers.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext } from "./types.ts"

/** One entry of the daemon activity registry's task dump (`debug.inspect`). */
type ActivityEntry = { state: string; at: number }

export async function collect(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args, runtime } = ctx
  const idsFlag = args.str("task-ids")
  const repoFlag = args.path("repo")
  const groupFlag = args.str("group")

  let taskIds: string[]
  let unresolvableRepos: readonly string[] = []
  if (idsFlag) {
    taskIds = idsFlag
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  } else if (repoFlag || groupFlag) {
    const { tasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
    // Throws when `--repo` itself does not resolve, and carries the task
    // repos it could not resolve into the response — an empty `tasks` list
    // beside a non-empty `unresolvableRepos` is NOT "nothing is running".
    const filter = repoFlag
      ? await repoFilter(
          runtime,
          repoFlag,
          tasks.map((t) => t.repo),
        )
      : null
    unresolvableRepos = filter?.unresolvableRepos ?? []
    taskIds = []
    for (const t of tasks) {
      if (groupFlag && t.groupId !== groupFlag) continue
      if (filter && !filter.matches(t.repo)) continue
      taskIds.push(t.id)
    }
  } else {
    throw new ApiError("collect needs --task-ids id1,id2, --group GROUPID, or --repo PATH", "MISSING_TARGET")
  }

  // The daemon's activity registry (one debug.inspect for the whole round) is
  // the "how long has it been in this state" source: per-task engine state +
  // the ms timestamp of its last transition. `null` = couldn't ask / no entry
  // (daemon restarted, task never observed) — an honest unknown, never a
  // fabricated "idle". Distinct from `running` (pty-host process truth):
  // the two diverging IS the diagnostic signal.
  let registry: Record<string, ActivityEntry> | null = null
  try {
    const dbg = await daemon.request<{ activity?: { tasks?: Record<string, ActivityEntry> } }>("debug.inspect")
    registry = dbg?.activity?.tasks ?? {}
  } catch {
    registry = null
  }

  const out: unknown[] = []
  for (const taskId of taskIds) {
    const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
    // One liveness read serves both `running` and the per-tab list a
    // coordinator needs to pick a `send --tab tab-N` target without a
    // second get-task hop (same join as get-task).
    const { tabs, running } = await runtime.taskTabs(taskId, taskEngineArgv(task))
    // `changes` is the UNCOMMITTED view; `base` is the committed one (ahead
    // and behind counts + diffstat vs the merge-base). Both matter when
    // picking a parallel-round winner: an attempt that commits its work reads
    // +0/−0 here, and `base.behind` says whether it was building against a
    // base that has since moved.
    //
    // `null` when there is nothing to read (no worktree) or the read failed —
    // the same honest-unknown `base` has always emitted beside it. Never
    // `{0,0}`: this verb's summary tells the caller non-zero means the attempt
    // cannot land, so a fabricated zero is a claim the caller acts on.
    const changes = task.worktreePath ? await runtime.readWorktreeChanges(task.worktreePath) : null
    const base = task.worktreePath
      ? await runtime.readBranchSignals(task.worktreePath, task.baseRef)
      : { baseRef: null, ahead: null, behind: null, diff: null }
    const entry = registry?.[task.id]
    // `forMs` = time in the CURRENT state ("idle for 40min" when state is
    // idle). Clock skew between daemon and CLI clamps to 0, never negative.
    const activity = entry
      ? { state: entry.state, at: new Date(entry.at).toISOString(), forMs: Math.max(0, Date.now() - entry.at) }
      : null
    out.push({
      taskId: task.id,
      title: task.title,
      branch: task.branch,
      worktreePath: task.worktreePath,
      vendor: task.vendor,
      status: task.status,
      ...(task.groupId ? { groupId: task.groupId } : {}),
      // Lineage read: who dispatched this task, so a parallel
      // round's parent is programmatically discoverable.
      ...(task.dispatcher ? { dispatcher: task.dispatcher } : {}),
      running,
      activity,
      tabs,
      changes,
      base,
    })
  }
  return { tasks: out, ...(unresolvableRepos.length > 0 ? { unresolvableRepos } : {}) }
}

export async function feedback(ctx: VerbContext): Promise<unknown> {
  const result = submitFeedback({
    title: ctx.args.require("title"),
    body: ctx.args.require("body"),
    categorySlug: ctx.args.str("category"),
  })
  return { ok: true, discussion: result }
}
