/**
 * `digest` — aggregate read over state Rove already persists (tasks touched in
 * the window, `AutomationRun.status`); no new data model or writer. Task
 * OUTCOMES are deliberately absent: completion flows to the spawning agent's
 * chat tab (`send`), and a stored `workerReport` would have no reader.
 */

import type { Automation, AutomationRun, AutomationRunStatus } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { daemonOf, repoFilter } from "./handler-helpers.ts"
import type { VerbContext, VerbSpec } from "./types.ts"

/** Default look-back for a digest, in days. */
const DEFAULT_SINCE_DAYS = 7

interface TaskDigest {
  /** Tasks touched inside the window (by `updatedAt`). */
  readonly total: number
}

interface RoutineDigest {
  readonly runs: number
  /** Per-status counts; only statuses actually seen appear. */
  readonly byStatus: Partial<Record<AutomationRunStatus, number>>
}

export interface Digest {
  readonly repo: string
  readonly since: string
  readonly tasks: TaskDigest
  readonly routines: RoutineDigest
}

/** Parse an ISO timestamp to epoch ms, or null when absent/unparseable. */
function epochOf(iso: string | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** Pure fold of already-filtered tasks + runs; callers own repo/window filtering. */
export function buildDigest(
  repo: string,
  sinceMs: number,
  tasks: readonly SerializedTask[],
  runs: readonly AutomationRun[],
): Digest {
  const byStatus: Partial<Record<AutomationRunStatus, number>> = {}
  for (const run of runs) byStatus[run.status] = (byStatus[run.status] ?? 0) + 1

  return {
    repo,
    since: new Date(sinceMs).toISOString(),
    tasks: { total: tasks.length },
    routines: { runs: runs.length, byStatus },
  }
}

async function digest(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args, runtime } = ctx
  const repoFlag = args.requireRepo("repo")
  const sinceMs = Date.now() - (args.int("since-days") ?? DEFAULT_SINCE_DAYS) * 86_400_000

  const { tasks: allTasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
  const { automations } = await daemon.request<{ automations: Automation[] }>("automation.list")
  // Zero tasks beside non-empty `unresolvableRepos` is a failed lookup, not a quiet week.
  const filter = await repoFilter(runtime, repoFlag, [
    ...allTasks.map((t) => t.repo),
    ...automations.map((a) => a.repo),
  ])
  const repo = filter.target

  const tasks: SerializedTask[] = []
  for (const task of allTasks) {
    // Only board CARDS count; `main` seats and `dir` entries would add a constant.
    if ((task.kind ?? "task") !== "task") continue
    if ((epochOf(task.updatedAt) ?? 0) < sinceMs) continue
    if (filter.matches(task.repo)) tasks.push(task)
  }

  const runs: AutomationRun[] = []
  for (const automation of automations) {
    if (!filter.matches(automation.repo)) continue
    const page = await daemon.request<{ runs: AutomationRun[] }>("automation.runs", { id: automation.id })
    for (const run of page.runs) {
      if ((epochOf(run.at) ?? 0) >= sinceMs) runs.push(run)
    }
  }

  return {
    ...buildDigest(repo, sinceMs, tasks, runs),
    ...(filter.unresolvableRepos.length > 0 ? { unresolvableRepos: filter.unresolvableRepos } : {}),
  }
}

export const DIGEST_VERB: VerbSpec = {
  name: "digest",
  group: "read",
  summary:
    "Aggregate a repo's recent agent work: tasks touched in the window plus routine run outcomes. Reads state Rove already persists — the measurement any workflow change has to move.",
  flags: [
    {
      name: "repo",
      type: "string",
      required: true,
      placeholder: "PATH",
      description: "Repo root (git toplevel). Relative paths resolve against $PWD.",
    },
    {
      name: "since-days",
      type: "int",
      default: String(DEFAULT_SINCE_DAYS),
      placeholder: "N",
      description: "Look-back window in days.",
    },
  ],
  handler: digest,
}
