/** Pure poll-cadence math for the Ops activity monitor; no IO, no opentui. */

import type { ChatTabTurnState } from "@/engine/turn-detector"

/**
 * Transcript-probe poll cadence. The probe (`latestTranscriptMtime`) is NOT
 * free: for claude it stats every `.jsonl` in an unboundedly growing dir. So
 * it backs off: MIN while the engine writes, doubling toward MAX after
 * {@link ACTIVITY_IDLE_RAMP_POLLS} unchanged reads; any mtime advance snaps back.
 */
export const ACTIVITY_POLL_MIN_MS = 2500
export const ACTIVITY_POLL_MAX_MS = 20000
/** Unchanged reads before each step up; the interval doubles per step. */
const ACTIVITY_IDLE_RAMP_POLLS = 3

/** Fast floor for the turn-status capture-pane poll (mid-turn / fallback fixed cadence). */
export const TURN_STATUS_POLL_MS = 1500
/** Backed-off cap when this session's transcript and pane are quiescent. */
export const TURN_STATUS_POLL_MAX_MS = 6000

/** Next activity-poll delay given the current one and the unchanged-read streak. */
export function nextActivityPollDelay(currentMs: number, idleStreak: number): number {
  if (idleStreak < ACTIVITY_IDLE_RAMP_POLLS) return ACTIVITY_POLL_MIN_MS
  return Math.min(currentMs * 2, ACTIVITY_POLL_MAX_MS)
}

/**
 * Back off an idle session's pane capture; resume fast polling when its own
 * transcript advances or its turn is running.
 */
export function nextTurnStatusPollDelay(
  currentMs: number,
  sessionMtimeAdvanced: boolean,
  published: ChatTabTurnState | null,
): number {
  if (sessionMtimeAdvanced) return TURN_STATUS_POLL_MS
  if (published === "running") return TURN_STATUS_POLL_MS
  return Math.min(currentMs * 2, TURN_STATUS_POLL_MAX_MS)
}
