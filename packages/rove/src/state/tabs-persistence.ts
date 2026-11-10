/**
 * Where the daemon's tab store keeps terminal tabs: one `terminalTabs.<taskId>`
 * key per task in state.json, the shape every reader (CLI `get-task`, the
 * bridge's tab feed, `inspect`, a TUI's first paint) already parses. The
 * daemon is the only writer; everything else changes tabs through `tabs.apply`.
 */

import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import type { TabsPersistence } from "@sma1lboy/rove-daemon/daemon/tabs-store"
import { loadStateFile, patchStateFile } from "./store.ts"

export const TERMINAL_TABS_PREFIX = "terminalTabs."

export function terminalTabsKey(taskId: string): string {
  return `${TERMINAL_TABS_PREFIX}${taskId}`
}

export const stateFileTabsPersistence: TabsPersistence = {
  load() {
    const out: Record<string, SharedTabs> = {}
    for (const [key, value] of Object.entries(loadStateFile())) {
      if (!key.startsWith(TERMINAL_TABS_PREFIX)) continue
      const state = value as SharedTabs | null
      if (state && Array.isArray(state.tabs)) out[key.slice(TERMINAL_TABS_PREFIX.length)] = state
    }
    return out
  },
  save(changes) {
    const patch: Record<string, unknown> = {}
    for (const [taskId, state] of Object.entries(changes)) patch[terminalTabsKey(taskId)] = state ?? undefined
    patchStateFile(patch)
  },
}
