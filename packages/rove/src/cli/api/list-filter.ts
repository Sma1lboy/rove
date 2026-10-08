/**
 * `list --repo/--status/--activity`: narrow the task list to what a caller is
 * looking for. Filters AND together; values inside one csv flag OR together.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { TASK_ACTIVITY_STATES } from "../../engine/hook-events.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { type ActivityView, activityView, readActivityRegistry } from "./activity-view.ts"
import { repoFilter } from "./handler-helpers.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

export interface ListFilters {
  readonly repo?: string
  readonly statuses?: ReadonlySet<string>
  readonly activities?: ReadonlySet<string>
}

function csvOf(ctx: VerbContext, name: string, allowed: readonly string[]): ReadonlySet<string> | undefined {
  const raw = ctx.args.str(name)
  if (raw === undefined) return undefined
  const values = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const bad = values.find((v) => !allowed.includes(v))
  if (bad !== undefined || values.length === 0) {
    throw new ApiError(`--${name} takes a comma list of ${allowed.join(", ")}`, "BAD_FLAG", helpStep("list"))
  }
  return new Set(values)
}

/** `null` when no filter flag was passed, so the unfiltered response stays byte-identical. */
export function listFilters(ctx: VerbContext): ListFilters | null {
  const repo = ctx.args.path("repo")
  const statuses = csvOf(ctx, "status", TASK_STATUSES)
  const activities = csvOf(ctx, "activity", TASK_ACTIVITY_STATES)
  if (!repo && !statuses && !activities) return null
  return { repo, statuses, activities }
}

export async function filterTaskList(
  ctx: VerbContext,
  daemon: DaemonRpc,
  tasks: readonly SerializedTask[],
  filters: ListFilters,
): Promise<{
  tasks: Array<SerializedTask & { activity?: ActivityView }>
  unresolvableRepos?: readonly string[]
}> {
  // A path is only meaningful on this machine, so another machine's task never matches --repo.
  const isLocal = (t: SerializedTask) => !t.origin || t.origin.machineId === "local"
  const repo = filters.repo
    ? await repoFilter(
        ctx.runtime,
        filters.repo,
        tasks.filter(isLocal).map((t) => t.repo),
      )
    : null
  const kept = tasks.filter(
    (t) => (!repo || (isLocal(t) && repo.matches(t.repo))) && (!filters.statuses || filters.statuses.has(t.status)),
  )
  let out: Array<SerializedTask & { activity?: ActivityView }> = kept
  if (filters.activities) {
    const wanted = filters.activities
    // A state Rove cannot read (no engine yet, a remote machine's task) never matches.
    const registry = await readActivityRegistry(daemon)
    const local = kept.filter(isLocal)
    const views = await Promise.all(local.map((t) => activityView(registry, t)))
    out = local.flatMap((task, i) => {
      const activity = views[i]
      return activity && wanted.has(activity.state) ? [{ ...task, activity }] : []
    })
  }
  return {
    tasks: out,
    ...(repo && repo.unresolvableRepos.length > 0 ? { unresolvableRepos: repo.unresolvableRepos } : {}),
  }
}
