/**
 * Tab reorder within a task (sidebar move mode): the pure
 * `moveTab` core (edge-stop, no wrap) and the mounted-vs-background fork in
 * `moveTaskTab` — order must land in the view (`tabsByTask`) AND the daemon's
 * tab store, which persists it so it survives restart (`rehydrateTabs` keeps
 * array order). The kv snapshot is the daemon's; this side never writes it.
 */

import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync.ts"
import { moveTaskTab } from "../../src/tui-react/workspace/terminal-tabs-move.ts"
import type { TabsSnapshotKv } from "../../src/tui-react/workspace/terminal-tabs-persist.ts"
import { tabActivationListeners, tabsByTask, takeTabMove } from "../../src/tui-react/workspace/terminal-tabs-shared.ts"
import { type TabsState, moveTab, rehydrateTabs } from "../../src/tui/workspace/terminal-tabs-core.ts"
import { type TabsSyncDaemon, attachTabsDaemon, flushTabs } from "../tui-react/tabs-sync-daemon.ts"

function state(ids: readonly string[]): TabsState {
  return {
    tabs: ids.map((id, i) => ({ kind: "engine" as const, id, title: null, ordinal: i + 1 })),
    activeId: ids[0] as string,
    nextOrdinal: ids.length + 1,
  }
}

const order = (s: TabsState): string[] => s.tabs.map((t) => t.id)

describe("moveTab (core)", () => {
  it("swaps a tab with its neighbour in either direction", () => {
    const s = state(["tab-1", "tab-2", "tab-3"])
    expect(order(moveTab(s, "tab-2", 1))).toEqual(["tab-1", "tab-3", "tab-2"])
    expect(order(moveTab(s, "tab-2", -1))).toEqual(["tab-2", "tab-1", "tab-3"])
    // activeId is position-independent — a move never changes it.
    expect(moveTab(s, "tab-2", 1).activeId).toBe("tab-1")
  })

  it("edge-stops: first up / last down return the SAME state, no wrap", () => {
    const s = state(["tab-1", "tab-2"])
    expect(moveTab(s, "tab-1", -1)).toBe(s)
    expect(moveTab(s, "tab-2", 1)).toBe(s)
  })

  it("no-ops on an unknown tab id", () => {
    const s = state(["tab-1"])
    expect(moveTab(s, "tab-9", 1)).toBe(s)
  })

  it("survives the persistence round-trip — rehydrate keeps the moved order", () => {
    const moved = moveTab(state(["tab-1", "tab-2", "tab-3"]), "tab-3", -1)
    expect(order(rehydrateTabs(moved, ["zsh"]))).toEqual(["tab-1", "tab-3", "tab-2"])
  })
})

describe("moveTaskTab (background write)", () => {
  let daemon: TabsSyncDaemon | null = null

  beforeEach(() => resetTabsSyncForTests())
  afterEach(() => {
    daemon?.detach()
    daemon = null
  })

  /** A daemon holding these tasks' tabs, attached and loaded. */
  async function withDaemon(tasks: Record<string, TabsState>): Promise<TabsSyncDaemon> {
    daemon = await attachTabsDaemon(tasks as unknown as Record<string, SharedTabs>)
    return daemon
  }

  function kvStub(): TabsSnapshotKv & { writes: Array<[string, unknown]> } {
    const writes: Array<[string, unknown]> = []
    return {
      store: {},
      writes,
      set(key, value) {
        writes.push([key, value])
      },
    }
  }

  it("writes the view and the daemon's tabs when no component owns the task — never the kv", async () => {
    const kv = kvStub()
    const { tabs } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
    expect(moveTaskTab(kv, "t1", "tab-2", -1)).toBe(true)
    expect(order(tabsByTask.get("t1") as TabsState)).toEqual(["tab-2", "tab-1"])
    await flushTabs()
    expect(order(tabs("t1") as TabsState)).toEqual(["tab-2", "tab-1"])
    expect(order(tabsByTask.get("t1") as TabsState)).toEqual(["tab-2", "tab-1"])
    expect(kv.writes).toEqual([])
  })

  it("before the daemon's tabs load, reads the kv snapshot and moves in the view only", () => {
    const kv = kvStub()
    kv.store["terminalTabs.t2"] = state(["tab-1", "tab-2", "tab-3"])
    expect(moveTaskTab(kv, "t2", "tab-1", 1)).toBe(true)
    expect(order(tabsByTask.get("t2") as TabsState)).toEqual(["tab-2", "tab-1", "tab-3"])
    expect(kv.writes).toEqual([])
  })

  it("keeps the daemon's empty tabs authoritative over an older populated snapshot", async () => {
    const kv = kvStub()
    kv.store["terminalTabs.t1"] = state(["tab-1", "tab-2"])
    const { store } = await withDaemon({ t1: state([]) })
    const before = store.get("t1")
    expect(moveTaskTab(kv, "t1", "tab-2", -1)).toBe(false)
    await flushTabs()
    expect(tabsByTask.get("t1")?.tabs).toEqual([])
    expect(store.get("t1")).toEqual(before)
    expect(kv.writes).toEqual([])
  })

  it("edge-stop writes NOTHING — top/bottom is a silent no-op", async () => {
    const kv = kvStub()
    const { store } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
    const before = store.get("t1")
    const shown = tabsByTask.get("t1")
    expect(moveTaskTab(kv, "t1", "tab-1", -1)).toBe(false)
    await flushTabs()
    expect(tabsByTask.get("t1")).toBe(shown)
    expect(store.get("t1")).toEqual(before)
    expect(kv.writes).toEqual([])
  })

  it("returns false for a task that never opened tabs", async () => {
    const { tabs } = await withDaemon({})
    expect(moveTaskTab(kvStub(), "ghost", "tab-1", 1)).toBe(false)
    expect(tabs("ghost")).toBeUndefined()
  })

  it("a mounted claimant owns the write — background touches nothing", async () => {
    // Same claim protocol as closeTaskTab: a listener that consumes the
    // request stands in for the mounted TerminalTabs, and moveTaskTab must
    // then leave the view and the daemon alone.
    const kv = kvStub()
    const { store } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
    const before = store.get("t1")
    const shown = tabsByTask.get("t1")
    const claims: Array<{ tabId: string; delta: -1 | 1 }> = []
    const claimant = (): void => {
      const move = takeTabMove("t1")
      if (move) claims.push(move)
    }
    tabActivationListeners.add(claimant)
    try {
      expect(moveTaskTab(kv, "t1", "tab-2", -1)).toBe(true)
    } finally {
      tabActivationListeners.delete(claimant)
    }
    expect(claims).toEqual([{ tabId: "tab-2", delta: -1 }])
    await flushTabs()
    expect(tabsByTask.get("t1")).toBe(shown)
    expect(store.get("t1")).toEqual(before)
    expect(kv.writes).toEqual([])
  })
})
