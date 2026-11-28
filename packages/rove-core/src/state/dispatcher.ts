/**
 * Dispatcher opt-in (docs/design/dispatcher.md), gating field-note filing
 * and recall in the spawn-time worktree protocol. Read fresh from state.json at
 * each decision, so toggling needs no daemon restart. Off by default.
 */

import { getPersistedBool } from "./store.ts"

export const DISPATCHER_KEY = "experimental.dispatcher"

export function dispatcherEnabled(): boolean {
  return getPersistedBool(DISPATCHER_KEY, false)
}
