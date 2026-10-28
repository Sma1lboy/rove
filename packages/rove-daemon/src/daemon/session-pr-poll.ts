/**
 * Status polling for session PRs (`task.sessionPrs`): PRs a task's session
 * opened from directories rove doesn't track, so there is no branch to
 * `gh pr list --head`. Each URL is polled on its own schedule key and run on
 * the same worker pool as the branch pass (`runPrStatusPass`). Cadence and
 * keep-last-on-error follow the branch pass; no stale marker is written.
 */

import type { DaemonOrchestrator, DaemonTask as Task } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import type { PrPollSchedule, PrUrlRunner } from "./pr-status-collector.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

/** Schedule key of one attached PR; cannot collide with a task id or an `id::extra` key. */
export function sessionPrKey(taskId: string, url: string): string {
  return `${taskId}::pr::${url}`
}

/** Remote (`ssh://`) projects have no local `gh` view of their PRs; every other task kind polls. */
export function pollableSessionPrs(task: Task): NonNullable<Task["sessionPrs"]> {
  if (task.repo.startsWith("ssh://") || task.worktreePath?.startsWith("ssh://")) return []
  return task.sessionPrs ?? []
}

export interface SessionPrPassContext {
  readonly runtime: Pick<DaemonRuntimeAdapter, "prStatus">
  readonly run: PrUrlRunner
  readonly now: number
  readonly at: string
  readonly schedule: PrPollSchedule
  /** The pass's backoff config, forwarded to `runtime.prStatus.nextPoll`. */
  readonly cfg: unknown
  readonly rand?: () => number
}

/** One job per due attached PR; each resolves to the task id when its stored status changed. */
export function sessionPrJobs(
  orch: DaemonOrchestrator,
  tasks: readonly Task[],
  ctx: SessionPrPassContext,
): Array<() => Promise<string | undefined>> {
  const jobs: Array<() => Promise<string | undefined>> = []
  for (const task of tasks) {
    for (const { url } of pollableSessionPrs(task)) {
      const entry = ctx.schedule.get(sessionPrKey(task.id, url))
      if (entry && ctx.now < entry.nextAllowedAt) continue
      jobs.push(() => pollSessionPr(orch, task.id, url, entry?.failures ?? 0, ctx))
    }
  }
  return jobs
}

async function pollSessionPr(
  orch: DaemonOrchestrator,
  taskId: string,
  url: string,
  prevFailures: number,
  ctx: SessionPrPassContext,
): Promise<string | undefined> {
  const { runtime, schedule, now, cfg, rand } = ctx
  const key = sessionPrKey(taskId, url)
  try {
    const result = await ctx.run(url)
    if (result.kind === "error") {
      logDaemonInfo(
        "pr-status-poller",
        `gh pr view failed (${result.error}) for task ${taskId} session PR ${url} — keeping last status, backing off`,
      )
      schedule.set(key, runtime.prStatus.nextPoll({ kind: "error", error: result.error }, prevFailures, now, cfg, rand))
      return undefined
    }
    const next = result.kind === "pr" ? runtime.prStatus.mapView(result.view, ctx.at) : null
    if (!next) {
      schedule.set(key, runtime.prStatus.nextPoll({ kind: "empty" }, prevFailures, now, cfg, rand))
      return undefined
    }
    // Re-read: the task or the attachment may have gone during the await.
    const attached = orch.getTask(taskId)?.sessionPrs?.find((p) => p.url === url)
    if (!attached) {
      schedule.delete(key)
      return undefined
    }
    // `sameStatus` ignores `lastError`; `next` carries none, so writing clears one left behind.
    let changed: string | undefined
    if (attached.status?.lastError !== undefined || !runtime.prStatus.sameStatus(attached.status, next)) {
      await orch.setSessionPrStatus(taskId, url, next)
      changed = taskId
    }
    const settled = next.lifecycle === "merged" || next.lifecycle === "closed"
    schedule.set(key, runtime.prStatus.nextPoll({ kind: "pr", settled }, prevFailures, now, cfg, rand))
    return changed
  } catch (err) {
    logDaemonError("pr-status-poller", err)
    schedule.set(key, runtime.prStatus.nextPoll({ kind: "error", error: "network" }, prevFailures, now, cfg, rand))
    return undefined
  }
}
