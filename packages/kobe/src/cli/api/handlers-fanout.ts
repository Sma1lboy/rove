/**
 * Verb handlers for `collect` and `feedback` — grouped separately from
 * `handlers-tasks.ts` since they don't touch single-task CRUD. The
 * `fan-out` handler that named this file folded into `add --count`
 * (`handlers-add.ts`, issue #30); the file keeps its name so its git
 * history stays traceable.
 */

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { DEFAULT_FEEDBACK_CATEGORY_SLUG, submitFeedback } from "../../lib/feedback.ts"
import { daemonOf } from "./handler-helpers.ts"
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
  if (idsFlag) {
    taskIds = idsFlag
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  } else if (repoFlag || groupFlag) {
    const target = repoFlag ? await runtime.resolveRepoRoot(repoFlag) : null
    const { tasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
    taskIds = []
    for (const t of tasks) {
      if (t.archived) continue
      if (groupFlag && t.groupId !== groupFlag) continue
      if (target !== null && (await runtime.resolveRepoRoot(t.repo)) !== target) continue
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
    const { tabs, running } = await runtime.taskTabs(taskId)
    // `changes` is the UNCOMMITTED view; `base` is the committed one (ahead
    // count + diffstat vs the merge-base). Both matter when picking a
    // parallel-round winner: an attempt that commits its work reads +0/−0 here.
    const changes = task.worktreePath ? await runtime.readWorktreeChanges(task.worktreePath) : { added: 0, deleted: 0 }
    const base = task.worktreePath
      ? await runtime.readBranchSignals(task.worktreePath)
      : { baseRef: null, ahead: null, diff: null }
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
      // Lineage read (issue #21): who dispatched this task, so a parallel
      // round's parent is programmatically discoverable.
      ...(task.dispatcher ? { dispatcher: task.dispatcher } : {}),
      running,
      activity,
      tabs,
      changes,
      base,
    })
  }
  return { tasks: out }
}

export async function feedback(ctx: VerbContext): Promise<unknown> {
  const result = submitFeedback({
    title: ctx.args.require("title"),
    body: ctx.args.require("body"),
    categorySlug: ctx.args.str("category"),
  })
  return { ok: true, discussion: result }
}
