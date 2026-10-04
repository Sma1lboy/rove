/**
 * Rate-limit auto-resume: on `failure: "rate_limit"`, find when the exhausted
 * quota window resets, persist it as `Task.quotaResume` (survives restarts),
 * then deliver a continue prompt into the still-alive engine session.
 *
 *  - Quota reading is engine-owned, reached via the `QuotaUsageCache`.
 *  - LIVE sessions only: a respawned engine has no context and would burn
 *    quota redoing work.
 *  - Never gated on `hasSubscribers` — resuming unwatched is the point.
 */

import type { PluginHost } from "../plugins/runtime.ts"
import type { ObservedLanguage } from "../prompts/observed-language.ts"
import type { DaemonOrchestrator, DaemonTask, EngineQuotaUsage } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import type { QuotaUsageCache } from "./quota-usage-cache.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

/**
 * Continue prompt in the task's observed language (a timer fires with no user
 * message in hand); no observation → English. A function, not a constant: the
 * daemon outlives any one task's language.
 */
export function quotaResumeContinuePrompt(language: ObservedLanguage | undefined): string {
  return language === "zh"
    ? "从中断的地方继续这个任务。上面的对话记录里已经完成的工作不要重做。"
    : "Continue the task from where it stopped. The transcript above shows the work already completed — do not redo it."
}

/** How often the runner scans for due resumes. */
export const DEFAULT_QUOTA_RESUME_TICK_MS = 60_000

/** Tasks whose armed schedule is due at `nowMs` and still deliverable. */
export function dueQuotaResumes(tasks: readonly DaemonTask[], nowMs: number): DaemonTask[] {
  return tasks.filter((task) => {
    if (!task.quotaResume || !task.worktreePath) return false
    if (task.deletion) return false
    const at = Date.parse(task.quotaResume.resumeAt)
    return Number.isFinite(at) && at <= nowMs
  })
}

/**
 * Earliest future reset among EXHAUSTED windows, or null. An allowed window's
 * `resetsAt` is rolling metadata and would resume before the limit clears.
 */
export function exhaustedResetAtMs(usage: EngineQuotaUsage, nowMs: number): number | null {
  const candidates = usage.windows
    .filter((w) => w.percent >= 100 && w.resetsAt != null && w.resetsAt > nowMs)
    .map((w) => w.resetsAt as number)
  return candidates.length > 0 ? Math.min(...candidates) : null
}

/**
 * Arm the resume from vendor usage (via the cache, so an event storm is one
 * upstream fetch). No usable reset arms nothing; the sticky `rate_limited`
 * badge is then the only signal.
 */
export async function scheduleQuotaResume(
  orch: DaemonOrchestrator,
  runtime: DaemonRuntimeAdapter,
  cache: QuotaUsageCache,
  taskId: string,
  now: () => number = Date.now,
  plugins?: () => Pick<PluginHost, "handleUiReport"> | null,
): Promise<void> {
  const task = orch.getTask(taskId)
  if (!task || !task.worktreePath || task.deletion) return

  // maxAge 0 = want the freshest view (the limit was JUST hit); the cache's
  // per-vendor fetch floor still bounds the upstream request rate.
  const usage = await cache.get(task.vendor ?? runtime.defaultTaskVendor, 0)
  const resetAtMs = usage ? exhaustedResetAtMs(usage, now()) : null
  if (resetAtMs == null) return

  // A past reset still arms; the next sweep tick delivers.
  const resumeAt = new Date(resetAtMs).toISOString()
  await orch.setQuotaResume(taskId, {
    resumeAt,
    requestedAt: new Date(now()).toISOString(),
  })
  logDaemonInfo("quota-resume", `armed task=${taskId} resumeAt=${resumeAt}`)
  plugins?.()?.handleUiReport({
    kind: "quota.exhausted",
    taskId,
    detail: { vendor: task.vendor ?? runtime.defaultTaskVendor, resumeAt },
  })
}

/**
 * Cleared BEFORE delivery so an overlapping tick can't double-type. A failed
 * delivery is logged and dropped; a later limit hit re-arms.
 */
async function resumeDueTask(
  orch: DaemonOrchestrator,
  runtime: DaemonRuntimeAdapter,
  task: DaemonTask,
  plugins?: () => Pick<PluginHost, "handleUiReport"> | null,
): Promise<void> {
  await orch.setQuotaResume(task.id, null)
  const delivered = await runtime.deliverPromptToLiveEngine(
    { id: task.id, vendor: task.vendor, command: task.command, worktreePath: task.worktreePath },
    quotaResumeContinuePrompt(task.observedLanguage),
  )
  logDaemonInfo("quota-resume", `resume task=${task.id} delivered=${delivered}`)
  plugins?.()?.handleUiReport({ kind: "quota.resumed", taskId: task.id, detail: { delivered } })
}

/** Stateless per tick, so persisted schedules need no re-arm after restart. */
export function startQuotaResumeRunner(
  orch: DaemonOrchestrator,
  runtime: DaemonRuntimeAdapter,
  tickMs: number = DEFAULT_QUOTA_RESUME_TICK_MS,
  now: () => number = Date.now,
  plugins?: () => Pick<PluginHost, "handleUiReport"> | null,
): ReturnType<typeof startTicker> {
  // Ungated on purpose. `startTicker` must treat `tickMs <= 0` as disabled:
  // `collectors.ts` passes 0 through `??`, which would be a ~1000 Hz sweep.
  return startTicker({
    name: "quota-resume",
    tickMs,
    run: async () => {
      for (const task of dueQuotaResumes(orch.listTasks(), now())) {
        await resumeDueTask(orch, runtime, task, plugins).catch((err) => logDaemonError("quota-resume", err))
      }
    },
  })
}
