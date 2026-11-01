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

export function csvOf(
  ctx: VerbContext,
  name: string,
  allowed: readonly string[],
  verb = "list",
): ReadonlySet<string> | undefined {
  const raw = ctx.args.str(name)
  if (raw === undefined) return undefined
  const values = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const bad = values.find((v) => !allowed.includes(v))
  if (bad !== undefined || values.length === 0) {
    throw new ApiError(`--${name} takes a comma list of ${allowed.join(", ")}`, "BAD_FLAG", helpStep(verb))
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

// `satisfies` makes tsc fail when SerializedTask gains or loses a key, so `--fields` never drifts from the wire.
const TASK_FIELDS = {
  id: true,
  title: true,
  repo: true,
  branch: true,
  worktreePath: true,
  kind: true,
  scratch: true,
  noProject: true,
  routine: true,
  status: true,
  pinned: true,
  archived: true,
  vendor: true,
  command: true,
  prStatus: true,
  modelEffort: true,
  model: true,
  tier: true,
  groupId: true,
  observedLanguage: true,
  deletion: true,
  quotaResume: true,
  linkedWorkItem: true,
  dispatcher: true,
  parentTaskId: true,
  sharesWorkspaceOf: true,
  cwdSubpath: true,
  ptyAlias: true,
  requireReport: true,
  prompt: true,
  baseRef: true,
  worktreeName: true,
  extraRepos: true,
  sessionPrs: true,
  report: true,
  origin: true,
  repoId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Record<keyof SerializedTask, true>

/** Every name `list --fields` accepts: the task's own keys plus the ones `list` adds. */
export const LIST_FIELDS: readonly string[] = [...Object.keys(TASK_FIELDS), "repoCount", "activity"]

/** `--fields a,b`: the keys each task row keeps, or `undefined` for the full row. */
export function listFields(ctx: VerbContext): readonly string[] | undefined {
  const fields = csvOf(ctx, "fields", LIST_FIELDS)
  return fields ? [...fields] : undefined
}

/** Keeps only `fields` on each row; a key a task does not carry stays absent rather than `null`. */
export function projectTasks<T extends object>(tasks: readonly T[], fields: readonly string[]): Partial<T>[] {
  return tasks.map((task) => {
    const row: Record<string, unknown> = {}
    for (const field of fields) if (field in task) row[field] = (task as Record<string, unknown>)[field]
    return row as Partial<T>
  })
}
