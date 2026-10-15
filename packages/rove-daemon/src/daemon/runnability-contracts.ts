/** Should-run: whether a tick sent to a task would be used. Re-exported from `contracts.ts`. */

/** Evaluated in this order; the first match is the reason, so the owner sees the most actionable one. */
export const SKIP_REASONS = [
  "task-missing",
  "awaiting-owner",
  "report-missing",
  "quota",
  "engine-error",
  "engine-dead",
  "awaiting-permission",
  "busy",
] as const

export type SkipReason = (typeof SKIP_REASONS)[number]

export type SkipVerdict = {
  readonly run: false
  readonly reason: SkipReason
  /** Human-readable specifics (the failure note, the missing cause, the question). */
  readonly detail?: string
  /** ISO-8601; only `quota`, when the reset time is known. The block clears itself then. */
  readonly until?: string
  /** `awaiting-owner`: the open gates. */
  readonly gateIds?: readonly string[]
}

export type RunnabilityVerdict = { readonly run: true } | SkipVerdict

/** `rove api should-run` / `send --if-runnable` exit code for a skip. */
export const SHOULD_RUN_SKIP_EXIT_CODE = 3

/** Read a stored verdict back; undefined unless it is a well-formed skip. */
export function parseSkipVerdict(value: unknown): SkipVerdict | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const raw = value as Partial<SkipVerdict>
  if (raw.run !== false || !(SKIP_REASONS as readonly unknown[]).includes(raw.reason)) return undefined
  const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
  return {
    run: false,
    reason: raw.reason as SkipReason,
    ...(text(raw.detail) ? { detail: raw.detail } : {}),
    ...(text(raw.until) ? { until: raw.until } : {}),
    ...(Array.isArray(raw.gateIds) ? { gateIds: raw.gateIds.filter((g): g is string => typeof g === "string") } : {}),
  }
}
