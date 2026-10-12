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
 * Fold a turn boundary into the tab's awaiting delivery. A turn-complete only
 * ends it once the delivery's own turn began (a paste can queue behind the
 * previous prompt); a failed turn always does, since the 400 case may never
 * start one.
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
    await markDeliveryMissing(deps, { taskId, tabId, cause: "turn-complete", needsTurnStart: true })
  } else if (kind === "turn-failed") {
    const note = detail?.note ?? (detail?.failure ? `failure: ${detail.failure}` : undefined)
    await markDeliveryMissing(deps, { taskId, tabId, cause: "turn-failed", ...(note ? { note } : {}) })
  }
}

/**
 * The engine stopped working on the tab's newest awaiting delivery with no
 * report: mark it `missing` and raise its Inbox row. No-op when nothing is
 * awaiting. `needsTurnStart` guards `turn-complete`: a Stop before the
 * delivery's own `turn-start` ends an EARLIER prompt the paste queued behind.
 */
export async function markDeliveryMissing(
  deps: DeliveryDeps,
  event: {
    readonly taskId: string
    readonly tabId: string | null
    readonly cause: DeliveryMissingCause
    readonly note?: string
    readonly needsTurnStart?: boolean
    /** Only a delivery pinned to exactly this tab (engine death). */
    readonly exactTab?: boolean
  },
): Promise<Delivery | null> {
  const awaiting = deps.deliveries.awaitingFor(event.taskId, event.tabId, event.exactTab)
  if (!awaiting) return null
  if (event.needsTurnStart && !awaiting.turnStartedAt) return null
  const missing = await deps.deliveries.markMissing(awaiting.id, event.cause, event.note).catch((err: unknown) => {
    logDaemonError("delivery-missing", err)
    return undefined
  })
  if (!missing) return null
  await deps.inbox
    .recordReportMissing(
      missing.taskId,
      missing.tabId ?? event.tabId,
      { id: missing.id, cause: event.cause },
      event.note,
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
 */
export async function sweepStalledDeliveries(
  deps: DeliveryDeps,
  activity: { stateOf(taskId: string, tabId: string | null): string | undefined },
): Promise<void> {
  const now = (deps.now ?? Date.now)()
  for (const delivery of deps.deliveries.allAwaiting()) {
    if (now - Date.parse(delivery.at) < DELIVERY_STALL_MS) continue
    const state = activity.stateOf(delivery.taskId, delivery.tabId)
    if (state === "running" || state === "permission_needed") continue
    await markDeliveryMissing(deps, {
      taskId: delivery.taskId,
      tabId: delivery.tabId,
      cause: "stalled",
      note: `tab state: ${state ?? "unknown"}`,
    })
  }
}
