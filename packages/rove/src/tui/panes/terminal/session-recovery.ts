import type { PtyOpenResult } from "@sma1lboy/rove-daemon/daemon/protocol"

/** Process facts only: terminal replay cannot prove conversation resumption. */
export type SessionRecovery = "live" | "relaunched" | "restored" | null

export function sessionRecovery(result: PtyOpenResult): SessionRecovery {
  if (!result.alive) return result.replay.length > 0 ? "restored" : null
  if (result.respawned === true) return "relaunched"
  // Old hosts omit created; silence is not proof that this is the same child.
  if (result.created === false) return "live"
  return null
}
