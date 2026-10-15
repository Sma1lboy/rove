/**
 * What happens to a delivery after it is armed: the agent reports it, or the
 * daemon notices the engine stopped without one. Shared by the RPC handlers,
 * the engine-report / exit-record / stall-sweep detectors, and the routine
 * runner so they all move one record the same way.
 */

import type { AttentionInboxStore } from "./attention-inbox.ts"
import type { AutomationsStore } from "./automations-store.ts"
import type { AutomationRun, DaemonOrchestrator, EngineActivityDetail, EngineActivityKind } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DeliveriesStore } from "./deliveries-store.ts"
import {
  DELIVERY_EVIDENCE_MAX_CHARS,
  DELIVERY_EVIDENCE_MAX_ITEMS,
  DELIVERY_NEXT_MAX_CHARS,
  DELIVERY_OUTCOMES,
  DELIVERY_STALL_MS,
  DELIVERY_SUMMARY_MAX_CHARS,
  type Delivery,
  type DeliveryMissingCause,
  type DeliveryReport,
} from "./delivery-contracts.ts"

export interface DeliveryDeps {
  readonly deliveries: DeliveriesStore
  readonly inbox: Pick<AttentionInboxStore, "recordReportMissing" | "deleteDeliveryEpisode" | "recordRoutineResponse">
  readonly orch: Pick<DaemonOrchestrator, "getTask" | "setWorkerReport">
  readonly automations: Pick<AutomationsStore, "get" | "getRun">
  readonly now?: () => number
}

export type DeliveryReportInput = Omit<DeliveryReport, "at" | "evidence"> & { readonly evidence?: readonly string[] }

/**
 * A run as the Routines page and `routine-runs` see it: `response` and
 * `deliveryStatus` come from the linked delivery, the one record of what the
 * agent said. Runs without a delivery (they predate deliveries) pass through.
 */
export function withDeliveryReport(run: AutomationRun, deliveries: Pick<DeliveriesStore, "get">): AutomationRun {
  const delivery = run.deliveryId ? deliveries.get(run.deliveryId) : undefined
  if (!delivery) return run
  const { response: _stored, ...rest } = run
  return {
    ...rest,
    deliveryStatus: delivery.status,
    ...(delivery.report ? { response: { text: delivery.report.summary, at: delivery.report.at } } : {}),
  }
}

/** Throws on a malformed report; the verb refuses rather than truncating. */
function validateReport(input: DeliveryReportInput): Omit<DeliveryReport, "at"> {
  if (!DELIVERY_OUTCOMES.includes(input.outcome)) {
    throw new Error(`outcome must be one of ${DELIVERY_OUTCOMES.join("|")}`)
  }
  const summary = typeof input.summary === "string" ? input.summary.trim() : ""
  if (summary.length === 0) throw new Error("summary is required")
  if (summary.length > DELIVERY_SUMMARY_MAX_CHARS) {
    throw new Error(`summary is ${summary.length} characters; the cap is ${DELIVERY_SUMMARY_MAX_CHARS}`)
  }
  const evidence = input.evidence ?? []
  if (evidence.length > DELIVERY_EVIDENCE_MAX_ITEMS) {
    throw new Error(`${evidence.length} evidence items; the cap is ${DELIVERY_EVIDENCE_MAX_ITEMS}`)
  }
  for (const item of evidence) {
    if (typeof item !== "string") throw new Error("evidence must be strings")
    if (item.length > DELIVERY_EVIDENCE_MAX_CHARS) {
      throw new Error(`an evidence item is ${item.length} characters; the cap is ${DELIVERY_EVIDENCE_MAX_CHARS}`)
    }
  }
  const next = input.next?.trim()
  if (next && next.length > DELIVERY_NEXT_MAX_CHARS) {
    throw new Error(`next is ${next.length} characters; the cap is ${DELIVERY_NEXT_MAX_CHARS}`)
  }
  return { outcome: input.outcome, summary, evidence: [...evidence], ...(next ? { next } : {}) }
}

/** Task cards show one line; the full summary stays on the delivery. */
function cardSummary(summary: string): string {
  const line = summary.split("\n").find((l) => l.trim().length > 0) ?? summary
  return line.length > 280 ? `${line.slice(0, 279)}…` : line
}

/**
 * Record (or replace) a delivery's report. A late report on a `missing`
 * delivery flips it back and clears its Inbox row. Null for an unknown id.
 */
export async function reportDelivery(
  deps: DeliveryDeps,
  deliveryId: string,
  input: DeliveryReportInput,
): Promise<Delivery | null> {
  const report = validateReport(input)
  const saved = await deps.deliveries.setReport(deliveryId, report)
  if (!saved) return null
  const { delivery, wasMissing } = saved
  if (wasMissing) {
    await deps.inbox
      .deleteDeliveryEpisode(deliveryId)
      .catch((err: unknown) => logDaemonError("delivery-report-inbox", err))
  }
  // Cards read the task's own report; keep it current without a second call.
  if (deps.orch.getTask(delivery.taskId)) {
    await deps.orch
      .setWorkerReport(delivery.taskId, { summary: cardSummary(report.summary) })
      .catch((err: unknown) => logDaemonError("delivery-report-card", err))
  }
  await recordRoutineResponse(deps, delivery)
  return delivery
}

/** A routine run's report is its response: surface it as the Routines episode. */
async function recordRoutineResponse(deps: DeliveryDeps, delivery: Delivery): Promise<void> {
  if (delivery.source !== "routine" || !delivery.automationRunId) return
  const run = deps.automations.getRun(delivery.automationRunId)
  const automation = run ? deps.automations.get(run.automationId) : undefined
  if (!run || !automation) return
  await deps.inbox
    .recordRoutineResponse(
      { automationId: automation.id, name: automation.name, status: run.status, runNumber: run.runNumber },
      run.taskId ?? delivery.taskId,
      (deps.now ?? Date.now)(),
    )
    // The report is already stored; an Inbox write must not fail the verb.
    .catch((err: unknown) => logDaemonError("delivery-report-routine-inbox", err))
}

/**
 * Report whatever the tab is currently awaiting. Null when nothing is armed:
 * a caller that only wants to settle an expectation (a gate raise) must not
 * invent one.
 */
export async function reportCurrentDelivery(
  deps: DeliveryDeps,
  taskId: string,
  tabId: string | null,
  input: DeliveryReportInput,
): Promise<Delivery | null> {
  const awaiting = deps.deliveries.awaitingFor(taskId, tabId)
  return awaiting ? await reportDelivery(deps, awaiting.id, input) : null
}

/** A `turn-start` on the tab: the awaiting delivery's own turn began. */
export async function noteDeliveryTurnStart(deps: DeliveryDeps, taskId: string, tabId: string | null): Promise<void> {
  await deps.deliveries.noteTurnStart(taskId, tabId).catch((err: unknown) => logDaemonError("delivery-turn-start", err))
}

/**
 * Fold a turn boundary into the tab's awaiting deliveries. A tab runs its
 * prompts in arming order, so events match by lineage, not recency:
 * - `turn-start` begins the OLDEST delivery whose turn has not started;
 * - `turn-complete`, `turn-interrupted` and `session-end` end the OLDEST
 *   delivery whose turn HAS started (a Stop with none started belongs to an
 *   earlier prompt the paste queued behind);
 * - `turn-failed` ends the oldest started delivery, else the oldest awaiting
 *   one: a rejected prompt (400) never starts a turn.
 * A rate-limited failure marks the delivery without an Inbox row: the
 * engine's own `rate_limited` episode covers it and quota-resume continues
 * the turn, after which a late report still lands.
 */
export async function trackDeliveryTurn(
  deps: DeliveryDeps,
  taskId: string,
  tabId: string | null,
  kind: EngineActivityKind,
  detail: EngineActivityDetail | undefined,
): Promise<void> {
  if (kind === "turn-start") await noteDeliveryTurnStart(deps, taskId, tabId)
  else if (kind === "turn-complete") {
    await markDeliveryMissing(deps, { taskId, tabId, cause: "turn-complete", scope: "started" })
  } else if (kind === "turn-interrupted") {
    await markDeliveryMissing(deps, { taskId, tabId, cause: "interrupted", scope: "started" })
  } else if (kind === "session-end") {
    await markDeliveryMissing(deps, { taskId, tabId, cause: "session-end", scope: "started" })
  } else if (kind === "turn-failed") {
    const note = detail?.note ?? (detail?.failure ? `failure: ${detail.failure}` : undefined)
    await markDeliveryMissing(deps, {
      taskId,
      tabId,
      cause: detail?.failure === "rate_limit" ? "rate-limited" : "turn-failed",
      scope: "started-or-oldest",
      ...(note ? { note } : {}),
    })
  }
}

/**
 * The engine stopped working on awaiting deliveries with no report: mark them
 * `missing` and raise their Inbox rows. No-op when nothing matches. `scope`
 * picks which of the tab's deliveries (oldest first) the stop ends: the oldest
 * one whose turn started, that or else the oldest, or all of them (the engine
 * process is gone).
 */
export async function markDeliveryMissing(
  deps: DeliveryDeps,
  event: {
    readonly taskId: string
    readonly tabId: string | null
    readonly cause: DeliveryMissingCause
    readonly note?: string
    readonly scope: "started" | "started-or-oldest" | "all"
    /** Only deliveries pinned to exactly this tab (engine death). */
    readonly exactTab?: boolean
  },
): Promise<Delivery[]> {
  const awaiting = deps.deliveries.awaitingOn(event.taskId, event.tabId, event.exactTab)
  const started = awaiting.filter((d) => d.turnStartedAt)
  const targets =
    event.scope === "all"
      ? awaiting
      : event.scope === "started"
        ? started.slice(0, 1)
        : [started[0] ?? awaiting[0]].filter((d): d is Delivery => d !== undefined)
  const marked: Delivery[] = []
  for (const delivery of targets) {
    const missing = await markOneMissing(deps, delivery, event.cause, event.note, event.tabId)
    if (missing) marked.push(missing)
  }
  return marked
}

async function markOneMissing(
  deps: DeliveryDeps,
  delivery: Delivery,
  cause: DeliveryMissingCause,
  note: string | undefined,
  eventTab: string | null,
): Promise<Delivery | null> {
  const missing = await deps.deliveries.markMissing(delivery.id, cause, note).catch((err: unknown) => {
    logDaemonError("delivery-missing", err)
    return undefined
  })
  if (!missing) return null
  if (cause === "rate-limited") return missing
  await deps.inbox
    .recordReportMissing(
      missing.taskId,
      missing.tabId ?? eventTab,
      { id: missing.id, cause },
      note,
      (deps.now ?? Date.now)(),
    )
    .catch((err: unknown) => logDaemonError("delivery-missing-inbox", err))
  return missing
}

/**
 * Backstop for signals that never arrive (no failure hook, a prompt rejected
 * before any turn started): an awaiting delivery older than
 * {@link DELIVERY_STALL_MS} whose tab is neither `running` nor
 * `permission_needed` is missing. `awaiting-input` is not a stop.
 *
 * Activity is in-memory, so after a daemon restart a mid-turn tab reads
 * unknown until its next hook: age counts from `bootedAt` when that is later
 * than the delivery, so a restart never flags work still in flight, while an
 * engine that emits no hooks is still caught {@link DELIVERY_STALL_MS} after boot.
 */
export async function sweepStalledDeliveries(
  deps: DeliveryDeps,
  activity: { stateOf(taskId: string, tabId: string | null): string | undefined },
  bootedAt = 0,
): Promise<void> {
  const now = (deps.now ?? Date.now)()
  for (const delivery of deps.deliveries.allAwaiting()) {
    if (now - Math.max(Date.parse(delivery.at), bootedAt) < DELIVERY_STALL_MS) continue
    const state = activity.stateOf(delivery.taskId, delivery.tabId)
    if (state === "running" || state === "permission_needed") continue
    await markOneMissing(deps, delivery, "stalled", `tab state: ${state ?? "unknown"}`, delivery.tabId)
  }
}
