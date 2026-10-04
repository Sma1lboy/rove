/**
 * Pure half of the activity registry: `(state, event) → state`, nothing to
 * mount. `activity-registry.ts` holds the live map, timers and subscribers and
 * re-exports these names. Being stateless is what lets
 * `kobe/src/engine/hook-events.ts` re-export {@link reduceActivity} (kobe
 * depends on kobe-daemon, never the reverse), so it is the one definition.
 */

import type { EngineActivityDetail, EngineActivityKind, TaskActivityState } from "./contracts.ts"

/**
 * Fold a normalized event into the next activity state.
 *   session-start                  → idle
 *   turn-start                     → running
 *   turn-complete                  → turn_complete
 *   turn-failed (rate_limit/billing)→ rate_limited
 *   turn-failed (other)            → error
 *   awaiting-input                 → permission_needed (permission prompt OR a
 *                                    question dialog — either way the engine is
 *                                    blocked on the user; `detail.waiting` keeps why)
 *   session-end                    → idle
 */
export function reduceActivity(
  previous: TaskActivityState | undefined,
  kind: EngineActivityKind,
  detail?: EngineActivityDetail,
): TaskActivityState {
  switch (kind) {
    case "session-start":
    case "session-end":
    // Kimi fires Interrupt INSTEAD of Stop on a user interrupt — without
    // this the turn strands in `running` (docs/design/plugin-events.md §B).
    case "turn-interrupted":
      return "idle"
    case "turn-start":
      return "running"
    case "turn-complete":
      // Only a completion if a turn was in flight: running, or blocked on the
      // user mid-turn (an approved permission continues with no turn-start).
      // Engines also fire Stop for automated wakes (a background monitor
      // stream ending); a Stop on a KNOWN idle/sticky state is that, so keep
      // it. `undefined` (fresh or restarted daemon) is a turn that began
      // before the wipe — swallowing it would drop the ● lamp for every turn
      // that outlives a restart.
      return previous === "running" || previous === "permission_needed" || previous === undefined
        ? "turn_complete"
        : previous
    case "turn-failed":
      return detail?.failure === "rate_limit" || detail?.failure === "billing" ? "rate_limited" : "error"
    case "awaiting-input":
      return "permission_needed"
    default:
      // Lifecycle-only kinds never reach here via the daemon (gated by
      // affectsActivityState); a direct call is a no-op on the state.
      return previous ?? "idle"
  }
}

/** How long a non-idle, non-complete engine-activity state survives with no
 *  follow-up event before lapsing to idle (safety net for a missed Stop/SessionEnd). */
export const DEFAULT_ENGINE_STATE_TTL_MS = 10 * 60 * 1000

/**
 * States held until the next real hook event, never lapsed by the watchdog —
 * which polices only `running` (a missed Stop pinning it). `turn_complete`
 * keeps its checkmark. `permission_needed` / `error` / `rate_limited` are the
 * states needing a human, and a blocked engine writes nothing, so the mtime
 * probe always reads stale and would hide the ? badge after ~10min. They
 * clear via Stop → turn_complete, SessionEnd → idle, clearTask() or deletion.
 */
export const STICKY_STATES: ReadonlySet<TaskActivityState> = new Set([
  "turn_complete",
  "permission_needed",
  "error",
  "rate_limited",
  // A dead engine never writes, so the probe would idle exactly that tab.
  // Cleared by a new session-start in the tab.
  "dead",
])

export function resolveEngineStateTtlMs(): number {
  const raw = process.env.KOBE_ENGINE_STATE_TTL_MS
  if (raw === undefined) return DEFAULT_ENGINE_STATE_TTL_MS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ENGINE_STATE_TTL_MS
}

/**
 * Liveness probe result: latest transcript mtime (epoch ms), telling a silent
 * engine (missed Stop ⇒ idle) from a long turn still writing tool output
 * (keep the badge, re-arm). `undefined` when undeterminable; filesystem-only,
 * and a rejection counts as `undefined` ⇒ lapse.
 *
 * `completedAt` is the newest turn-completion marker. Mtime alone isn't
 * enough: an engine idle at its prompt keeps touching its transcript, so a
 * missed Stop would re-arm forever. A completion at/after the last write means
 * the turn ended, so the badge drops.
 */
export type ActivityLiveness =
  | { readonly unknown: true; readonly mtimeMs?: never; readonly completedAt?: never }
  | {
      readonly unknown?: false
      readonly mtimeMs?: number
      readonly completedAt?: number
    }

/** Own completion wins over writes; an unreadable session preserves the last running claim. */
export function activityStillWorking(
  live: ActivityLiveness | undefined,
  at: number,
  now: number,
  staleMs: number,
): boolean {
  if (!live) return false
  if (live.unknown) return true
  if (live.completedAt !== undefined && live.completedAt >= at) return false
  return live.mtimeMs !== undefined && live.mtimeMs > now - staleMs
}

/**
 * `vendor` is the REPORTING engine's id (the hook's `--engine`), not the
 * task's vendor: a wrapper id (`claudecpa` → cc-switch → claude) has no
 * transcript store, reads mtime 0 forever, and would lapse every long turn.
 */
export type ActivityLivenessProbe = (
  taskId: string,
  vendor?: string,
  /** The policed entry's own session transcript, when the hook piped one —
   *  lets the probe scope to THIS session instead of the whole worktree. */
  transcriptPath?: string,
) => Promise<ActivityLiveness | undefined>

/** The reporting engine's own session identity (from its hook payload). */
export interface EngineSessionInfo {
  readonly id: string
  readonly transcriptPath?: string
}
