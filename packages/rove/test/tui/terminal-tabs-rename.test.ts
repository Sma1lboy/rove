/**
 * Naming ONE tab by id: the pure `setTabTitle` core and the
 * mounted-vs-background fork in `renameTaskTab`.
 *
 * This is the TUI half of `rove api rename --tab`. Tab lifecycle was already
 * symmetric across the CLI — open, close, read, write — with naming the one
 * gap, and f2 could only ever rename the ACTIVE tab of the task on screen.
 *
 * The idempotence in `setTabTitle` is load-bearing, not a micro-optimisation:
 * it is why the rename needs no request/reply broker the way the CLOSE path
 * does. The CLI renames through the daemon AND broadcasts, so both writers
 * run — and a second write that returns the same object costs no re-render
 * and no second daemon write. A background rename lands in the view
 * (`tabsByTask`) and the daemon's tab store; the kv is never written.
 */

import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync.ts"
import type { TabsSnapshotKv } from "../../src/tui-react/workspace/terminal-tabs-persist.ts"
import { renameTaskTab } from "../../src/tui-react/workspace/terminal-tabs-rename.ts"
import {
  tabActivationListeners,
  tabsByTask,
  takeTabRename,
} from "../../src/tui-react/workspace/terminal-tabs-shared.ts"
import { type TabsState, rehydrateTabs, setTabTitle } from "../../src/tui/workspace/terminal-tabs-core.ts"
import { type TabsSyncDaemon, attachTabsDaemon, flushTabs } from "../tui-react/tabs-sync-daemon.ts"

function state(ids: readonly string[]): TabsState {
  return {
    tabs: ids.map((id, i) => ({ kind: "engine" as const, id, title: null, ordinal: i + 1 })),
    activeId: ids[0] as string,
    nextOrdinal: ids.length + 1,
  }
}

const titleOf = (s: TabsState, id: string): string | null | undefined => s.tabs.find((t) => t.id === id)?.title

describe("setTabTitle (core)", () => {
  it("names the tab it is given, not the active one", () => {
    const s = state(["tab-1", "tab-2"])
    const next = setTabTitle(s, "tab-2", "e2e")
    expect(titleOf(next, "tab-2")).toBe("e2e")
    // f2 renames the ACTIVE tab; a CLI naming a tab of a task nobody is
    // looking at has no "active" to mean.
    expect(titleOf(next, "tab-1")).toBeNull()
    expect(next.activeId).toBe("tab-1")
  })

  it("clears back to the default name on an empty or whitespace title", () => {
    const named = setTabTitle(state(["tab-1"]), "tab-1", "logs")
    expect(titleOf(setTabTitle(named, "tab-1", "   "), "tab-1")).toBeNull()
  })

  it("returns the SAME state when the title already matches — the idempotence the CLI relies on", () => {
    const named = setTabTitle(state(["tab-1"]), "tab-1", "logs")
    expect(setTabTitle(named, "tab-1", "logs")).toBe(named)
    expect(setTabTitle(named, "tab-1", " logs ")).toBe(named)
  })

  it("no-ops on an unknown tab id", () => {
    const s = state(["tab-1"])
    expect(setTabTitle(s, "tab-9", "x")).toBe(s)
  })

  it("survives the persistence round-trip", () => {
    const named = setTabTitle(state(["tab-1", "tab-2"]), "tab-2", "e2e")
    expect(titleOf(rehydrateTabs(named, ["zsh"]), "tab-2")).toBe("e2e")
  })
})

describe("renameTaskTab (background write)", () => {
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
    return { store: {}, writes, set: (key, value) => void writes.push([key, value]) }
  }

  it("writes the view and the daemon's tabs when no component owns the task — never the kv", async () => {
    const kv = kvStub()
    const { tabs } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
    expect(renameTaskTab(kv, "t1", "tab-2", "e2e")).toBe(true)
    expect(titleOf(tabsByTask.get("t1") as TabsState, "tab-2")).toBe("e2e")
    await flushTabs()
    expect(titleOf(tabs("t1") as TabsState, "tab-2")).toBe("e2e")
    expect(titleOf(tabsByTask.get("t1") as TabsState, "tab-2")).toBe("e2e")
    expect(kv.writes).toEqual([])
  })

  it("before the daemon's tabs load, reads the kv snapshot and renames in the view only", () => {
    const kv = kvStub()
    kv.store["terminalTabs.t2"] = state(["tab-1"])
    expect(renameTaskTab(kv, "t2", "tab-1", "logs")).toBe(true)
    expect(titleOf(tabsByTask.get("t2") as TabsState, "tab-1")).toBe("logs")
    expect(kv.writes).toEqual([])
  })

  it("returns false for a tab the task does not have, and for a task with no tabs", async () => {
    // Checked BEFORE publishing, so an unknown id can never report success
    // for a rename that made no transition.
    const kv = kvStub()
    const { store } = await withDaemon({ t1: state(["tab-1"]) })
    const before = store.get("t1")
    expect(renameTaskTab(kv, "t1", "tab-9", "x")).toBe(false)
    expect(renameTaskTab(kv, "ghost", "tab-1", "x")).toBe(false)
    await flushTabs()
    expect(store.get("t1")).toEqual(before)
    expect(store.get("ghost").state).toBeNull()
    expect(kv.writes).toEqual([])
  })

  it("re-applying the same name writes NOTHING but still reports the state holds", async () => {
    // The CLI renames through the daemon then broadcasts, so this path
    // routinely runs against a tab that already carries the title.
    const kv = kvStub()
    const { store } = await withDaemon({ t1: setTabTitle(state(["tab-1"]), "tab-1", "logs") })
    const before = store.get("t1")
    expect(renameTaskTab(kv, "t1", "tab-1", "logs")).toBe(true)
    await flushTabs()
    expect(store.get("t1")).toEqual(before)
    expect(kv.writes).toEqual([])
  })

  it("a mounted claimant owns the write — background touches nothing", async () => {
    // Same claim protocol as closeTaskTab/moveTaskTab: a listener that
    // consumes the request stands in for the mounted TerminalTabs, which
    // renames through its own state writer.
    const kv = kvStub()
    const { store } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
    const before = store.get("t1")
    const shown = tabsByTask.get("t1")
    const claims: Array<{ tabId: string; title: string }> = []
    const claimant = (): void => {
      const req = takeTabRename("t1")
      if (req) claims.push(req)
    }
    tabActivationListeners.add(claimant)
    try {
      expect(renameTaskTab(kv, "t1", "tab-2", "e2e")).toBe(true)
    } finally {
      tabActivationListeners.delete(claimant)
    }
    expect(claims).toEqual([{ tabId: "tab-2", title: "e2e" }])
    await flushTabs()
    expect(tabsByTask.get("t1")).toBe(shown)
    expect(store.get("t1")).toEqual(before)
    expect(kv.writes).toEqual([])
  })
})
