/**
 * Auto-fix CI: an opt-in, per-task loop that hands a failing PR's checks back to the task's engine.
 * What the daemon keeps on the task is small (`attempts`, the head sha it last tried); this file is the
 * rule for when to act, kept pure so every guard is testable.
 */

/** Attempts per task before the loop stops and asks for a person. */
export const AUTO_FIX_MAX = 3

export interface AutoFixState {
  /** Prompts sent since the toggle came on or the checks last passed. */
  readonly attempts: number
  /** The PR head sha the last prompt was for: a sha is tried once. */
  readonly lastSha?: string
  /** The cap was hit and the Inbox was told; stays until the checks pass or the toggle is cycled. */
  readonly stopped?: true
}

export interface AutoFixPr {
  readonly lifecycle: string
  readonly checkState: string
  readonly headSha?: string
}

export type AutoFixVerdict =
  | { readonly do: "skip" }
  /** Checks are red on a sha not tried yet, but the engine is busy: hold, the next tick looks again. */
  | { readonly do: "wait" }
  | { readonly do: "fire" }
  /** Red on a new sha with the cap spent: stop, and say so. */
  | { readonly do: "stop" }
  /** Green again: the next failure starts a fresh count. */
  | { readonly do: "reset" }

/** The engine states a prompt may be typed into: at rest, never mid-turn, in a menu, limited or dead. */
const AT_REST: Readonly<Record<string, true>> = { idle: true, turn_complete: true }

/**
 * What to do for one task on this tick. `engine` is the task-level activity (`undefined` = nothing has
 * reported, which is not known to be at rest).
 */
export function autoFixDecision(input: {
  readonly state: AutoFixState | undefined
  readonly pr: AutoFixPr | undefined
  readonly engine: string | undefined
}): AutoFixVerdict {
  const { state, pr, engine } = input
  if (!state || !pr) return { do: "skip" }
  if (pr.lifecycle !== "open" && pr.lifecycle !== "ready_to_merge") return { do: "skip" }
  if (pr.checkState === "passing") {
    return state.attempts > 0 || state.stopped || state.lastSha ? { do: "reset" } : { do: "skip" }
  }
  if (pr.checkState !== "failing" || !pr.headSha) return { do: "skip" }
  if (pr.headSha === state.lastSha) return { do: "skip" }
  if (state.stopped) return { do: "skip" }
  if (state.attempts >= AUTO_FIX_MAX) return { do: "stop" }
  return AT_REST[engine ?? ""] ? { do: "fire" } : { do: "wait" }
}

/** A stored state read back; anything malformed is no state (the toggle is off). */
export function coerceAutoFix(value: unknown): AutoFixState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as { attempts?: unknown; lastSha?: unknown; stopped?: unknown }
  const attempts = typeof v.attempts === "number" && Number.isInteger(v.attempts) && v.attempts >= 0 ? v.attempts : 0
  return {
    attempts: Math.min(attempts, AUTO_FIX_MAX),
    ...(typeof v.lastSha === "string" && v.lastSha.length > 0 ? { lastSha: v.lastSha } : {}),
    ...(v.stopped === true ? { stopped: true as const } : {}),
  }
}
