/**
 * `sync` — merge the base branch INTO a task's worktree (`task.syncBase`), the
 * inverse of `land`. A task that spans several repos syncs each against its own
 * base; one repo's conflict leaves its merge in place and does not stop the rest.
 */

import type { SyncReposResult } from "@sma1lboy/rove-daemon/daemon/contracts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, splitDaemonCode } from "./types.ts"

type SyncOutcome = { baseRef: string; alreadyCurrent: boolean } & Partial<Pick<SyncReposResult, "repos">>

export async function sync(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const repo = ctx.args.str("repo")
  const res = await daemon.request<{ result: SyncOutcome }>("task.syncBase", { taskId, ...(repo ? { repo } : {}) })
  const failed = res.result.repos?.find((r) => !r.ok)
  if (failed) {
    throw new ApiError(
      splitDaemonCode(failed.error ?? "")?.rest ?? failed.error ?? "sync failed",
      failed.code ?? "SYNC_FAILED",
      {
        taskId,
        failedRepo: failed.name,
        repos: res.result.repos,
        hint: "the other repos synced; a conflicted merge is left in place in its worktree — resolve and commit it there",
      },
    )
  }
  return { ok: true, taskId, ...res.result }
}
