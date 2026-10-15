/**
 * Should-run (docs/design/long-run-controls.md § 2): would a tick sent to this
 * task be used? A pure read over state the daemon already holds — activity,
 * gates, deliveries, the quota-resume schedule — so every caller (routine
 * runner, `should-run`, `send --if-runnable`, quota-resume) gets the same
 * answer. Reasons are checked in {@link SKIP_REASONS} order; the first match
 * wins so the owner sees the most actionable one.
 */

import type { DispatchRunnability } from "./automation-dispatch.ts"
import type {
  DaemonOrchestrator,
  DaemonTask,
  EngineActivityDetail,
  EngineQuotaUsage,
  TaskActivityState,
} from "./contracts.ts"
import type { DeliveriesStore } from "./deliveries-store.ts"
import type { Delivery } from "./delivery-contracts.ts"
import type { GatesStore } from "./gates-store.ts"
import { exhaustedResetAtMs } from "./quota-resume.ts"
import type { RunnabilityVerdict, SkipReason, SkipVerdict } from "./runnability-contracts.ts"

/** What the activity ledger knows about one tab (or the task rollup). */
export interface ActivityReading {
  readonly state: TaskActivityState
  readonly detail?: EngineActivityDetail
}

export interface RunnabilityDeps {
  readonly orch: Pick<DaemonOrchestrator, "getTask">
  readonly activity: { entryOf(taskId: string, tabId: string | null): ActivityReading | undefined }
  readonly gates: Pick<GatesStore, "list">
  readonly deliveries: Pick<DeliveriesStore, "listForTask" | "claims">
  readonly now?: () => number
  /** The reset instant (ms) of the vendor's exhausted quota window, from the usage cache; null when unknown or past. */
  readonly quotaResetAtMs?: (vendor: string | undefined, nowMs: number) => number | null
}

export interface RunnabilityOptions {
  /** Reasons the caller handles itself: a standing session revives `engine-dead`; quota-resume IS the quota. */
  readonly ignore?: readonly SkipReason[]
}

/** The tab id `send --tab new` carries: a tab that does not exist yet has no state to judge. */
export const NEW_TAB = "new"

const skip = (reason: SkipReason, extra: Omit<SkipVerdict, "run" | "reason"> = {}): SkipVerdict => ({
  run: false,
  reason,
  ...extra,
})

/** The tab's newest delivery that says something about the engine: skipped ticks never reached it. */
function newestDelivery(deps: RunnabilityDeps, taskId: string, tabId: string | null): Delivery | undefined {
  return deps.deliveries
    .listForTask(taskId)
    .find((d) => d.status !== "skipped" && (tabId === null || d.tabId === null || d.tabId === tabId))
}

/** A quota stop is the engine's own block: the delivery it ended is not an unreported tick. */
const isRateLimited = (delivery: Delivery): boolean =>
  delivery.status === "missing" && delivery.missing?.cause === "rate-limited"

function missingDetail(delivery: Delivery): string {
  const missing = delivery.missing
  return `${delivery.id} ended without a report (${missing?.cause ?? "unknown"})${missing?.note ? `: ${missing.note}` : ""}`
}

/**
 * When the quota block ends: the armed resume time while it is still ahead, else the usage cache's
 * exhausted window. Null means no known end, and an unknown quota is no reason to block (a resume
 * that declines clears `Task.quotaResume`, so a sticky badge must not outlive its reset).
 */
function quotaUntil(deps: RunnabilityDeps, task: DaemonTask, nowMs: number): string | null {
  const armed = task.quotaResume ? Date.parse(task.quotaResume.resumeAt) : Number.NaN
  if (armed > nowMs) return task.quotaResume?.resumeAt ?? null
  const cached = deps.quotaResetAtMs?.(task.vendor, nowMs) ?? null
  return cached === null ? null : new Date(cached).toISOString()
}

/**
 * `tabId` null = the whole task (its rollup); [NEW_TAB] = a tab about to be
 * created, judged on task-level state only.
 */
export function evaluateRunnability(
  deps: RunnabilityDeps,
  taskId: string,
  tabId: string | null,
  opts: RunnabilityOptions = {},
): RunnabilityVerdict {
  const now = (deps.now ?? Date.now)()
  const ignored = (reason: SkipReason): boolean => opts.ignore?.includes(reason) === true
  const task = deps.orch.getTask(taskId)
  if (!task || task.deletion) return skip("task-missing")

  const openGates = deps.gates.list({ taskId, status: "open" })
  if (openGates.length > 0 && !ignored("awaiting-owner")) {
    return skip("awaiting-owner", {
      detail: openGates[0]?.question,
      gateIds: openGates.map((g) => g.id),
    })
  }

  const fresh = tabId === NEW_TAB
  const tab = fresh ? null : tabId
  // A new tab has no state of its own, but a task whose last tick went unreported is still broken.
  const found = newestDelivery(deps, taskId, tab)
  const newest = found && isRateLimited(found) ? undefined : found
  if (newest?.status === "missing" && !newest.dismissedAt && !ignored("report-missing")) {
    return skip("report-missing", { detail: missingDetail(newest) })
  }
  if (fresh) return { run: true }

  const entry = deps.activity.entryOf(taskId, tab)
  const failure = entry?.detail?.failure
  if (entry?.state === "rate_limited" && failure !== "billing" && !ignored("quota")) {
    // Past its reset the badge is only stale; the next turn-start clears it.
    const until = quotaUntil(deps, task, now)
    if (until !== null) {
      return skip("quota", { until, ...(entry.detail?.note ? { detail: entry.detail.note } : {}) })
    }
  }
  const errored = entry?.state === "error" || (entry?.state === "rate_limited" && failure === "billing")
  if (errored && !ignored("engine-error")) {
    return skip("engine-error", { detail: entry?.detail?.note ?? (failure ? `failure: ${failure}` : undefined) })
  }
  if (entry?.state === "dead" && !ignored("engine-dead")) return skip("engine-dead")
  if (entry?.state === "permission_needed" && !ignored("awaiting-permission")) return skip("awaiting-permission")

  if (!ignored("busy")) {
    if (entry?.state === "running") return skip("busy", { detail: "a turn is running" })
    if (newest?.status === "awaiting") return skip("busy", { detail: `${newest.id} is still awaiting its report` })
    if (deps.deliveries.claims.isClaimed(taskId, tab)) return skip("busy", { detail: "a tick is being delivered" })
  }
  return { run: true }
}

/** Reads {@link RunnabilityDeps.quotaResetAtMs} from the cached usage snapshot; never fetches. */
export function quotaResetReader(
  quota: { peek(vendor: string): EngineQuotaUsage | null },
  defaultVendor: string,
): NonNullable<RunnabilityDeps["quotaResetAtMs"]> {
  return (vendor, nowMs) => {
    const usage = quota.peek(vendor ?? defaultVendor)
    return usage ? exhaustedResetAtMs(usage, nowMs) : null
  }
}

/**
 * The runner's and quota-resume's view of {@link evaluateRunnability}.
 * `freshQuota` reads the cached usage snapshot only: a firing that creates a
 * task has no activity or deliveries to judge, and an unknown quota is no
 * reason to skip it.
 */
export function createDispatchRunnability(
  deps: RunnabilityDeps,
  quota: { peek(vendor: string): EngineQuotaUsage | null },
  defaultVendor: string,
): DispatchRunnability {
  const resetAtMs = quotaResetReader(quota, defaultVendor)
  const withReset: RunnabilityDeps = { ...deps, quotaResetAtMs: resetAtMs }
  return {
    check: (taskId, tabId, ignore) => evaluateRunnability(withReset, taskId, tabId, ignore ? { ignore } : {}),
    freshQuota(vendor) {
      const resetAt = resetAtMs(vendor, (deps.now ?? Date.now)())
      return resetAt === null ? undefined : skip("quota", { until: new Date(resetAt).toISOString() })
    },
  }
}
