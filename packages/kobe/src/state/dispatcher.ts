/**
 * Dispatcher opt-in (docs/design/dispatcher.md), gating both the daemon's
 * dispatch feeder (radar digests → each repo's main session) and the
 * spawn-time `withDispatcherProtocol` prompt. Read fresh from state.json at
 * each decision, so toggling needs no daemon restart. Off by default.
 */

import { getPersistedBool } from "./store.ts"

export const DISPATCHER_KEY = "experimental.dispatcher"

export function dispatcherEnabled(): boolean {
  return getPersistedBool(DISPATCHER_KEY, false)
}
