/**
 * Verb handlers for `collect` and `feedback`. The parallel create path lives
 * in `handlers-add.ts` (`add --count`).
 */

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { submitFeedback } from "../../lib/feedback.ts"
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
    // Throws when `--repo` doesn't resolve; empty `tasks` beside non-empty
    // `unresolvableRepos` is NOT "nothing is running".
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

  // Per-task engine state + last-transition ms, one debug.inspect per round.
  // `null` = couldn't ask / no entry — an honest unknown, never a fabricated
  // "idle". Diverging from `running` (pty-host truth) IS the signal.
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
    // Tabs included so a coordinator can pick a `send --tab` target without
    // a get-task hop.
    const { tabs, running } = await runtime.taskTabs(taskId, taskEngineArgv(task))
    // `changes` is UNCOMMITTED; `base` is committed (ahead/behind + diffstat
    // vs merge-base). An attempt that commits reads +0/−0 in `changes`.
    // `null` when there's no worktree or the read failed — never `{0,0}`,
    // since callers treat non-zero as "cannot land" and act on a zero.
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
      // The worker's own claim (`set-status --report-*`), beside what the repo
      // actually shows.
      ...(task.report ? { report: task.report } : {}),
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
