/**
 * Adopt live-but-unlisted pty sessions into a task's tab state. The pty host
 * is the truth; the tab snapshot is intent, and they diverge (canonical-spawn
 * fallback, a tab closed while unmounted so the kill never reached the host,
 * an older rove). An unlisted session can't be opened, focused or closed.
 *
 * A live `<taskId>::<tabId>` becomes an engine tab under ITS OWN id, so a
 * mount attaches to the host session instead of respawning. Never steals
 * `activeId`: bookkeeping, not navigation.
 */

import type { CommandTab, EngineTab, TabsState, TerminalTab } from "./terminal-tabs-core"

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

/** A tab row `tab.add` may carry: a PTY-backed kind with the fields the strip and spawn path read. */
export function isAddedTab(raw: unknown): raw is EngineTab | CommandTab {
  if (typeof raw !== "object" || raw === null) return false
  if (!("id" in raw) || typeof raw.id !== "string") return false
  if (!("ordinal" in raw) || typeof raw.ordinal !== "number") return false
  if (!("title" in raw) || (raw.title !== null && typeof raw.title !== "string")) return false
  if (!("kind" in raw)) return false
  if (raw.kind === "engine") return true
  return raw.kind === "command" && "command" in raw && Array.isArray(raw.command)
}

/**
 * Fold in a tab another process created (`rove api tab-new` wrote it to
 * state.json and broadcast `tab.add`). This TUI's copy of the task's tabs
 * predates it: without the row the next mutation would overwrite the CLI's
 * write, and the 2s orphan poll would adopt its live PTY as an engine tab,
 * misreading a shell. Authoritative over such a guess, so a same-id row with
 * another kind replaces it; same kind merges, keeping the TUI-owned `title`
 * and live fields. Raises `nextOrdinal` so a local tab can't reuse the id; never
 * steals `activeId`. Returns `state` itself when nothing changes.
 */
export function absorbTab(state: TabsState, tab: EngineTab | CommandTab): TabsState {
  const nextOrdinal = Math.max(state.nextOrdinal, tab.ordinal + 1)
  const known = state.tabs.find((t) => t.id === tab.id)
  if (known?.kind === tab.kind) {
    const same = Object.entries(tab).every(
      ([key, value]) => JSON.stringify(Reflect.get(known, key)) === JSON.stringify(value),
    )
    if (same && nextOrdinal === state.nextOrdinal) return state
  }
  const merged: TerminalTab = known?.kind === tab.kind ? { ...known, ...tab, title: known.title } : tab
  const tabs = known ? state.tabs.map((t) => (t === known ? merged : t)) : [...state.tabs, merged]
  return { ...state, tabs, nextOrdinal }
}
