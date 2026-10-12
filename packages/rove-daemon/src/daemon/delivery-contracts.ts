/** Deliveries: a prompt handed to an engine tab WITH an expectation of a
 *  structured `rove api report`. Re-exported from `contracts.ts`. */

export type DeliverySource = "routine" | "send" | "gate-answer"

/** `skipped` is written only by the should-run layer. */
export type DeliveryStatus = "awaiting" | "reported" | "missing" | "skipped"

export type DeliveryOutcome = "done" | "partial" | "blocked" | "failed"

export const DELIVERY_OUTCOMES: readonly DeliveryOutcome[] = ["done", "partial", "blocked", "failed"]

export type DeliveryMissingCause = "turn-complete" | "turn-failed" | "engine-dead" | "stalled"

export interface DeliveryReport {
  readonly outcome: DeliveryOutcome
  readonly summary: string
  /** Commits, PR urls, test commands + result, file paths. */
  readonly evidence: readonly string[]
  /** What the next tick should do. */
  readonly next?: string
  /** ISO-8601. */
  readonly at: string
}

export interface Delivery {
  /** `d-<n>`, monotonic per daemon home. */
  readonly id: string
  readonly taskId: string
  /** `null` until the tab is known (`send --tab new`, a spawn in flight). */
  readonly tabId: string | null
  readonly source: DeliverySource
  readonly automationRunId?: string
  readonly gateId?: string
  /** First 200 chars of the delivered prompt, for the list view. */
  readonly promptHead: string
  /** ISO-8601, when armed. */
  readonly at: string
  readonly status: DeliveryStatus
  /** First `turn-start` seen after arming. A turn end before this belongs to
   *  an earlier prompt the engine was still working on. */
  readonly turnStartedAt?: string
  /** Why the expectation failed; set with status `missing`. */
  readonly missing?: { readonly cause: DeliveryMissingCause; readonly note?: string; readonly at: string }
  readonly report?: DeliveryReport
}

/** Stored summary cap, in characters. Over it the verb refuses rather than truncating. */
export const DELIVERY_SUMMARY_MAX_CHARS = 32_000
export const DELIVERY_EVIDENCE_MAX_ITEMS = 50
export const DELIVERY_EVIDENCE_MAX_CHARS = 2_000
export const DELIVERY_NEXT_MAX_CHARS = 4_000
export const DELIVERY_PROMPT_HEAD_CHARS = 200
/** Retention per task; every write re-serializes the whole document. */
export const MAX_DELIVERIES_PER_TASK = 50
/** An awaiting delivery older than this, on a tab that is not working, is missing. */
export const DELIVERY_STALL_MS = 10 * 60_000

/** The one-line footer naming the verb and the id, appended to a delivered prompt. */
export function deliveryFooter(deliveryId: string, api: string): string {
  return `[ROVE] When this turn ends, report: ${api} report --delivery ${deliveryId} --outcome done|partial|blocked|failed --summary … [--evidence …]… [--next …]`
}
