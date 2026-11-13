/**
 * `worktree-usage` — the disk each task's own worktrees take, largest first,
 * so a user running many tasks sees what `remove-worktree` would reclaim.
 * Only checkouts a task owns count: a project's own checkout, a directory
 * task's folder and a shared child's parent directory are never listed.
 * `--idle-days` / `--merged` narrow it to cleanup candidates before measuring.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import { gitRepoOf } from "@sma1lboy/rove-daemon/task-tree"
import type { CheckoutUsage } from "../../orchestrator/worktree/disk-usage.ts"
import { canonicalize } from "../../orchestrator/worktree/paths.ts"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/** du runs per checkout; a few at once keeps a big index from serialising on one tree. */
const CONCURRENCY = 4

export interface WorktreeUsageRow {
  readonly taskId: string
  readonly title: string
  readonly branch: string
  readonly archived: boolean
  readonly status: SerializedTask["status"]
  readonly updatedAt: string
  /** The task's PR as Rove last saw it on the forge; null when it has none. */
  readonly prLifecycle: string | null
  /** Sum over the checkouts on disk; null when one of them could not be measured. */
  readonly bytes: number | null
  readonly ignoredBytes: number | null
  readonly checkouts: readonly ({ readonly path: string } & CheckoutUsage)[]
}

/** The checkouts this task alone owns: its worktree and each materialised extra repo. */
export function ownedCheckouts(task: SerializedTask): string[] {
  if ((task.kind ?? "task") !== "task" || task.sharesWorkspaceOf) return []
  const primary = (task.worktreePath ?? "").trim()
  const extras = (task.extraRepos ?? []).map((r) => (r.worktreePath ?? "").trim())
  const repo = canonicalize(gitRepoOf(task))
  return [primary, ...extras].filter((p) => p.length > 0 && !samePath(canonicalize(p), repo))
}

export function sum(values: readonly (number | null)[]): number | null {
  let total = 0
  for (const v of values) {
    if (v === null) return null
    total += v
  }
  return total
}

export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function usageRow(ctx: VerbContext, task: SerializedTask): Promise<WorktreeUsageRow> {
  const paths = ownedCheckouts(task)
  const checkouts: ({ path: string } & CheckoutUsage)[] = []
  for (const path of paths) checkouts.push({ path, ...(await ctx.runtime.measureCheckout(path)) })
  // A checkout that isn't on disk takes no space; it counts as zero, not unknown.
  const present = checkouts.filter((c) => c.exists !== false)
  return {
    taskId: task.id,
    title: task.title,
    branch: task.branch,
    archived: task.archived === true,
    status: task.status,
    updatedAt: task.updatedAt,
    prLifecycle: task.prStatus?.lifecycle ?? null,
    bytes: sum(present.map((c) => c.bytes)),
    ignoredBytes: sum(present.map((c) => c.ignoredBytes)),
    checkouts,
  }
}

/** Largest first; an unmeasured row sorts last so it never hides behind a guess. */
function bySize(a: WorktreeUsageRow, b: WorktreeUsageRow): number {
  if (a.bytes === null || b.bytes === null) return a.bytes === null ? (b.bytes === null ? 0 : 1) : -1
  return b.bytes - a.bytes
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Cleanup filters; null when neither flag was passed. They AND together. */
export function candidateFilter(ctx: VerbContext): ((task: SerializedTask) => boolean) | null {
  const idleDays = ctx.args.nonNegativeInt("idle-days")
  const merged = ctx.args.bool("merged")
  if (idleDays === undefined && !merged) return null
  const cutoff = idleDays === undefined ? null : Date.now() - idleDays * DAY_MS
  return (task) => {
    if (merged && task.prStatus?.lifecycle !== "merged") return false
    if (cutoff === null) return true
    const touched = Date.parse(task.updatedAt)
    // An unreadable timestamp is never proof of idleness.
    return Number.isFinite(touched) && touched <= cutoff
  }
}

async function handleWorktreeUsage(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const keep = candidateFilter(ctx)
  const taskId = ctx.args.str("task-id")
  if (taskId !== undefined) {
    if (keep) throw new ApiError("--idle-days and --merged filter the full list, not --task-id", "BAD_FLAG")
    const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
    if (ownedCheckouts(task).length === 0) {
      throw new ApiError(`task ${taskId} owns no worktree`, "NO_WORKTREE", {
        hint: "a project's own checkout, a directory task and a shared child use a directory they don't own",
      })
    }
    return usageRow(ctx, task)
  }
  const tasks = (await daemon.request<{ tasks?: SerializedTask[] }>("task.list")).tasks ?? []
  const owners = tasks.filter((t) => ownedCheckouts(t).length > 0 && !t.deletion && (!keep || keep(t)))
  const rows = (await mapLimited(owners, CONCURRENCY, (t) => usageRow(ctx, t))).filter((r) =>
    r.checkouts.some((c) => c.exists !== false),
  )
  rows.sort(bySize)
  return {
    tasks: rows,
    bytes: sum(rows.map((r) => r.bytes)),
    ignoredBytes: sum(rows.map((r) => r.ignoredBytes)),
  }
}

export const WORKTREE_USAGE_VERB: VerbSpec = {
  name: "worktree-usage",
  group: "worktree",
  summary:
    "Disk used by each task's own worktrees (extra repos included), largest first, archived tasks too — what `remove-worktree` would reclaim. `ignoredBytes` is the gitignored part (dependencies, build output). A project's own checkout, a directory task and a shared child are never listed; a task whose worktree is not on disk is left out. --idle-days and --merged narrow the list to cleanup candidates (both given: both must hold); totals cover only what is listed. Returns { tasks: [{ taskId, title, branch, archived, status, updatedAt, prLifecycle, bytes, ignoredBytes, checkouts: [{ path, exists, bytes, ignoredBytes }] }], bytes, ignoredBytes }; with --task-id, that one row. A null size means it could not be measured, never zero.",
  flags: [
    F.taskId(false),
    {
      name: "idle-days",
      type: "uint",
      placeholder: "N",
      description: "Only tasks whose record has not changed in at least N days.",
    },
    { name: "merged", type: "bool", description: "Only tasks whose pull request Rove last saw merged." },
  ],
  handler: handleWorktreeUsage,
}
