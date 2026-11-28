/** React adapter for the framework-free Orchestrator state interface. */

import type { ReadableState } from "@sma1lboy/rove-core/lib/external-store.ts"
import { useSyncExternalStore } from "react"

export function useAccessor<T>(state: ReadableState<T>): T {
  return useSyncExternalStore(state.subscribe, state.get, state.get)
}
