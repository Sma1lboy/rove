/**
 * "Auto status flow" opt-in (docs/design/web-kanban.md M5), gating both the
 * daemon rule (`turn-start` on backlog → `in_progress`, monitor/status-rules.ts)
 * and the spawn-time prompt telling the agent to self-report `in_review`
 * (`withStatusProtocol`). Read fresh from state.json at each decision, so
 * toggling needs no daemon restart. Off by default.
 */

import { getPersistedBool } from "./store.ts"

export const AUTO_STATUS_KEY = "experimental.autoStatus"

export function autoStatusEnabled(): boolean {
  return getPersistedBool(AUTO_STATUS_KEY, false)
}
