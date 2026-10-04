/**
 * Adopt live-but-unlisted pty sessions into a task's tab state. The pty host
 * is the truth; the tab snapshot is intent, and they diverge (canonical-spawn
 * fallback, a tab closed while unmounted so the kill never reached the host,
 * an older kobe). An unlisted session can't be opened, focused or closed.
 *
 * A live `<taskId>::<tabId>` becomes an engine tab under ITS OWN id, so a
 * mount attaches to the host session instead of respawning. Never steals
 * `activeId`: bookkeeping, not navigation.
 */

import type { EngineTab, TabsState, TerminalTab } from "./terminal-tabs-core"

/** `tab-7` → 7: the strip labels by ordinal, so a fresh one would rename "Claude Code 7". */
function ordinalOf(tabId: string, fallback: number): number {
  const match = /^tab-(\d+)$/.exec(tabId)
  return match ? Number(match[1]) : fallback
}

/** Append unknown `tabIds` as engine tabs; returns `state` itself when nothing is new (callers skip the write). */
export function adoptTabs(state: TabsState, tabIds: readonly string[]): TabsState {
  const known = new Set(state.tabs.map((tab) => tab.id))
  const fresh: string[] = []
  for (const id of tabIds) {
    if (known.has(id)) continue
    known.add(id)
    fresh.push(id)
  }
  if (fresh.length === 0) return state

  let minted = state.nextOrdinal
  const adopted: EngineTab[] = fresh.map((id) => ({
    kind: "engine",
    id,
    title: null,
    ordinal: ordinalOf(id, minted++),
    // Already running; a spawn would start a second engine under this key.
    spawned: true,
  }))
  adopted.sort((a, b) => a.ordinal - b.ordinal)

  const tabs: TerminalTab[] = [...state.tabs, ...adopted]
  const maxOrdinal = tabs.reduce((max, tab) => Math.max(max, tab.ordinal), 0)
  return { tabs, activeId: state.activeId, nextOrdinal: Math.max(state.nextOrdinal, maxOrdinal + 1) }
}
