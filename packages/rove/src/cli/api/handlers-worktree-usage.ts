/**
 * `worktree-usage` — the disk each task's own worktrees take, largest first,
 * so a user running many tasks sees what `remove-worktree` would reclaim.
 * Only checkouts a task owns count: a project's own checkout, a directory
 * task's folder and a shared child's parent directory are never listed.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { samePath } from "@sma1lboy/rove-daemon/path-identity"
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
  const repo = canonicalize(task.repo)
  return [primary, ...extras].filter((p) => p.length > 0 && !samePath(canonicalize(p), repo))
}

function sum(values: readonly (number | null)[]): number | null {
  let total = 0
  for (const v of values) {
    if (v === null) return null
    total += v
  }
  return total
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
  const present = checkouts.filter((c) => c.exists)
  return {
    taskId: task.id,
    title: task.title,
    branch: task.branch,
    archived: task.archived === true,
    status: task.status,
    updatedAt: task.updatedAt,
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

async function handleWorktreeUsage(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.str("task-id")
  if (taskId !== undefined) {
    const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
    if (ownedCheckouts(task).length === 0) {
      throw new ApiError(`task ${taskId} owns no worktree`, "NO_WORKTREE", {
        hint: "a project's own checkout, a directory task and a shared child use a directory they don't own",
      })
    }
    return usageRow(ctx, task)
  }
  const tasks = (await daemon.request<{ tasks?: SerializedTask[] }>("task.list")).tasks ?? []
  const owners = tasks.filter((t) => ownedCheckouts(t).length > 0 && !t.deletion)
  const rows = (await mapLimited(owners, CONCURRENCY, (t) => usageRow(ctx, t))).filter((r) =>
    r.checkouts.some((c) => c.exists),
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
    "Disk used by each task's own worktrees (extra repos included), largest first, archived tasks too — what `remove-worktree` would reclaim. `ignoredBytes` is the gitignored part (dependencies, build output). A project's own checkout, a directory task and a shared child are never listed; a task whose worktree is not on disk is left out. Returns { tasks: [{ taskId, title, branch, archived, status, updatedAt, bytes, ignoredBytes, checkouts: [{ path, exists, bytes, ignoredBytes }] }], bytes, ignoredBytes }; with --task-id, that one row. A null size means it could not be measured, never zero.",
  flags: [F.taskId(false)],
  handler: handleWorktreeUsage,
}
