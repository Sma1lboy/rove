/**
 * `worktree-reclaim` — remove the worktrees of every cleanup candidate
 * (`--merged`, `--idle-days`) in one go, keeping each task and its branch.
 * Never forced: a checkout holding work, a busy engine or the caller's own
 * directory is reported as skipped, and the rest are still removed.
 */

import { errorMessage } from "@/lib/error-message"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { readActivityRegistry } from "./activity-view.ts"
import { daemonOf } from "./handler-helpers.ts"
import { type WorktreeRemoval, removableWorktree } from "./handlers-lifecycle.ts"
import { candidateFilter, mapLimited, ownedCheckouts, sum } from "./handlers-worktree-usage.ts"
import { ApiError, type VerbContext, type VerbSpec, splitDaemonCode } from "./types.ts"

const CONCURRENCY = 4

/** Engine states that mean someone is mid-work in the checkout. */
const ENGINE_BUSY = new Set(["running", "permission_needed"])

interface Candidate {
  readonly taskId: string
  readonly title: string
  readonly branch: string
  readonly worktreePath: string
  /** The checkout's size before removal; null when it could not be measured. */
  readonly bytes: number | null
}

interface Skipped extends Candidate {
  readonly code: string
  readonly message: string
}

function skipCode(err: unknown): { code: string; message: string } {
  if (err instanceof ApiError) return { code: err.code, message: err.message }
  const message = errorMessage(err)
  const split = splitDaemonCode(message)
  return split ? { code: split.code, message: split.rest.trim() || message } : { code: "REMOVE_FAILED", message }
}

async function handleWorktreeReclaim(ctx: VerbContext): Promise<unknown> {
  const keep = candidateFilter(ctx)
  if (!keep) {
    throw new ApiError("worktree-reclaim needs --merged or --idle-days: it never removes every worktree", "BAD_FLAG", {
      hint: "preview with --dry-run, e.g. `worktree-reclaim --merged --dry-run`",
      nextCommandArgs: ["api", "worktree-reclaim", "--merged", "--dry-run"],
    })
  }
  const dryRun = ctx.args.bool("dry-run") ?? false
  const daemon = daemonOf(ctx)
  const tasks = (await daemon.request<{ tasks?: SerializedTask[] }>("task.list")).tasks ?? []
  const owners = tasks.filter((t) => ownedCheckouts(t).length > 0 && !t.deletion && keep(t))
  const activity = await readActivityRegistry(daemon)
  if (!activity) {
    throw new ApiError("could not read engine activity, so which worktrees are in use is unknown", "BAD_DAEMON", {
      hint: "remove them one at a time with `remove-worktree --task-id`",
      nextCommandArgs: ["api", "inspect"],
    })
  }

  const measured = await mapLimited(owners, CONCURRENCY, async (task) => {
    const worktreePath = (task.worktreePath ?? "").trim()
    const usage = worktreePath ? await ctx.runtime.measureCheckout(worktreePath) : null
    return { task, worktreePath, exists: usage?.exists, bytes: usage?.bytes ?? null }
  })

  const removed: (Candidate & { residue?: WorktreeRemoval["residue"] })[] = []
  const skipped: Skipped[] = []
  for (const { task, worktreePath, exists, bytes } of measured) {
    // Already gone: nothing to reclaim, nothing worth reporting.
    if (!worktreePath || exists === false) continue
    const row: Candidate = { taskId: task.id, title: task.title, branch: task.branch, worktreePath, bytes }
    const skip = (code: string, message: string) => skipped.push({ ...row, code, message })
    if ((task.extraRepos ?? []).length > 0) {
      skip("MULTI_REPO", "spans several repos; `remove-worktree` or `delete` it on its own")
      continue
    }
    if (ENGINE_BUSY.has(activity.tasks[task.id]?.state ?? "idle")) {
      skip("TASK_BUSY", "an engine is still working or waiting on you in it")
      continue
    }
    try {
      removableWorktree(ctx, task)
      if (dryRun) {
        removed.push(row)
        continue
      }
      const res = await daemon.request<WorktreeRemoval>("worktree.remove", { path: worktreePath, force: false })
      removed.push(res.residue ? { ...row, residue: res.residue } : row)
    } catch (err) {
      const { code, message } = skipCode(err)
      skip(code, message)
    }
  }
  const bySize = (a: Candidate, b: Candidate) => (b.bytes ?? -1) - (a.bytes ?? -1)
  removed.sort(bySize)
  skipped.sort(bySize)
  return { dryRun, removed, skipped, bytes: sum(removed.map((r) => r.bytes)) }
}

export const WORKTREE_RECLAIM_VERB: VerbSpec = {
  name: "worktree-reclaim",
  group: "worktree",
  summary:
    "Remove the worktree of every cleanup candidate at once — the tasks `worktree-usage` lists with the same --merged / --idle-days filters (at least one is required) — keeping each task and its branch, so `ensure-worktree` can bring a checkout back. Never forced: a checkout with uncommitted, untracked or gitignored work, a task whose engine is running or waiting on you, a multi-repo task, a shared directory and the caller's own worktree are skipped with a code, and the rest are still removed. --dry-run reports what would be removed and changes nothing; it does not run the dirty check, which only the removal itself makes. Returns { dryRun, removed: [{ taskId, title, branch, worktreePath, bytes, residue? }], skipped: [{ …same, code, message }], bytes } — `bytes` is what the removed checkouts took, null when one could not be measured.",
  flags: [
    {
      name: "idle-days",
      type: "uint",
      placeholder: "N",
      description: "Only tasks whose record has not changed in at least N days.",
    },
    { name: "merged", type: "bool", description: "Only tasks whose pull request Rove last saw merged." },
    { name: "dry-run", type: "bool", description: "Report what would be removed without removing anything." },
  ],
  handler: handleWorktreeReclaim,
}
