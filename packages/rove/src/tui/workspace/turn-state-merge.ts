/**
 * Hook-wins merge of the two per-tab turn-state sources: the daemon's hook
 * `engine-state` push (sub-second) and the local quiescence poll (3–6 s,
 * works without hooks). Per tabId a live hook entry supersedes the poll; the
 * poll re-owns the tab when the entry clears or never appears. With no hook
 * data the output is the poll map unchanged.
 *
 * Known ceiling: a dropped Stop pins hook `running` until the daemon's lapse
 * watchdog (~10 min) or the next event; the poll's `done` is ignored meanwhile.
 */

import type { TaskActivityState } from "../../engine/hook-events.ts"
import type { ChatTabTurnState } from "../../engine/turn-detector.ts"

/** The slice of the client's `TaskEngineState` this merge consumes. */
export interface HookTabState {
  readonly state: TaskActivityState
  readonly sessionId?: string
  readonly transcriptPath?: string
  /** Key for the durable completion-seen mark; absent on the poll-only path. */
  readonly at?: number
}

/** Daemon activity state → tab-chip state. `null` = no hook claim (a replayed idle can still arrive; the poll owns it). */
export function activityTurnState(state: TaskActivityState): ChatTabTurnState | null {
  switch (state) {
    case "running":
      return "running"
    case "turn_complete":
      return "done"
    case "error":
      return "error"
    // NOT folded into `error`: "wait for the window" vs "broke, needs you"
    // ask for opposite actions, and the rail draws them apart (`◷` vs `×`).
    case "rate_limited":
      return "rate_limited"
    case "dead":
      return "dead"
    case "permission_needed":
      return "needs_input"
    case "idle":
      return null
  }
}

/** Returns `poll` by reference when no hook entry claims a tab, so callers can identity-compare. */
export function mergeTurnStates(
  hook: ReadonlyMap<string, HookTabState> | undefined,
  poll: ReadonlyMap<string, ChatTabTurnState>,
): ReadonlyMap<string, ChatTabTurnState> {
  if (!hook || hook.size === 0) return poll
  let out: Map<string, ChatTabTurnState> | null = null
  for (const [tabId, entry] of hook) {
    const turn = activityTurnState(entry.state)
    if (turn === null) continue
    if (!out) out = new Map(poll)
    out.set(tabId, turn)
  }
  return out ?? poll
}
