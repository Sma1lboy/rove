/**
 * A TUI's tabs come from the daemon's tab store (`tabs-sync.ts`). Wired to a
 * real store through an in-process transport, these replay what a second
 * client does to the same task and check what this TUI then shows.
 */

import type { SharedTabs, TabRow } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { diffTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { type TabsChangedPayload, TabsStore } from "@sma1lboy/rove-daemon/daemon/tabs-store"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { TabsTransport } from "../../src/client/remote-orchestrator-tabs"
import {
  attachTabsTransport,
  commitTaskTabs,
  ensureTabReservation,
  releaseTabReservation,
  reloadTabs,
  resetTabsSyncForTests,
  tabsByTask,
  tabsRevision,
} from "../../src/tui-react/workspace/tabs-sync"
import { type TabsState, addTab, closeTab, selectTab } from "../../src/tui/workspace/terminal-tabs-core"

const row = (id: string): TabRow => ({ kind: "engine", id, ordinal: Number(id.slice(4)), title: null })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const ids = (s: { tabs: readonly { id: string }[] } | null | undefined) => s?.tabs.map((t) => t.id)

let store: TabsStore
let detach: () => void
let listeners: Set<(e: TabsChangedPayload) => void>

function transport(): TabsTransport {
  return {
    apply: async (taskId, ops) => store.apply(taskId, ops),
    list: async () => store.list(),
    reserve: async (taskId, count) => store.reserve(taskId, count),
    release: async (taskId, from, to) => store.release(taskId, from, to),
    onChanged: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Another client (a second TUI, the web, the CLI) changing the task's tabs. */
function other(taskId: string, reducer: (s: SharedTabs) => SharedTabs): void {
  const copy = store.get(taskId).state as SharedTabs
  store.apply(taskId, diffTabs(copy, reducer(copy)))
}

beforeEach(async () => {
  resetTabsSyncForTests()
  listeners = new Set()
  store = new TabsStore(undefined, {
    publish: (channel: string, payload: unknown) => {
      if (channel === "tabs.changed") for (const l of listeners) l(payload as TabsChangedPayload)
    },
  } as never)
  store.apply("t", [{ op: "seed", state: { tabs: ["tab-1", "tab-2", "tab-3"].map(row), nextOrdinal: 4 } }])
  detach = attachTabsTransport(transport())
  await flush()
})

afterEach(() => detach())

describe("tabs-sync", () => {
  it("loads the daemon's tabs on attach", () => {
    expect(ids(tabsByTask.get("t"))).toEqual(["tab-1", "tab-2", "tab-3"])
  })

  it("paints this TUI's own change at once, and keeps it once the daemon confirms", async () => {
    const view = tabsByTask.get("t") as TabsState
    const shown = commitTaskTabs("t", closeTab(view, "tab-2").state)
    expect(ids(shown)).toEqual(["tab-1", "tab-3"])
    await flush()
    expect(ids(store.get("t").state)).toEqual(["tab-1", "tab-3"])
    expect(ids(tabsByTask.get("t"))).toEqual(["tab-1", "tab-3"])
  })

  it("drops a tab another client closed, falling to its left neighbour if this TUI was on it", async () => {
    commitTaskTabs("t", selectTab(tabsByTask.get("t") as TabsState, "tab-3"))
    await flush()
    other("t", (s) => ({ ...s, tabs: s.tabs.filter((tab) => tab.id !== "tab-3") }))
    expect(ids(tabsByTask.get("t"))).toEqual(["tab-1", "tab-2"])
    expect(tabsByTask.get("t")?.activeId).toBe("tab-2")
  })

  it("never resurrects a tab another client closed while this TUI's own write was in flight", async () => {
    const view = tabsByTask.get("t") as TabsState
    // This TUI renames tab-3 while the other client closes it.
    commitTaskTabs("t", { ...view, tabs: view.tabs.map((tab) => (tab.id === "tab-3" ? { ...tab, title: "x" } : tab)) })
    other("t", (s) => ({ ...s, tabs: s.tabs.filter((tab) => tab.id !== "tab-3") }))
    await flush()
    expect(ids(tabsByTask.get("t"))).toEqual(["tab-1", "tab-2"])
    expect(ids(store.get("t").state)).toEqual(["tab-1", "tab-2"])
  })

  it("mints new tabs from its own reservation: another client opening at the same moment gets a different id", async () => {
    ensureTabReservation("t")
    await flush()
    const base = tabsByTask.get("t") as TabsState
    const mine = addTab(base)
    // The other client opens through the daemon's counter in the same instant.
    store.apply("t", [{ op: "open", row: { kind: "engine", title: null } }])
    commitTaskTabs("t", mine, base)
    await flush()
    const all = ids(store.get("t").state) ?? []
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(5)
    expect(ids(tabsByTask.get("t"))).toEqual(all)
  })

  it("a task switch's release and re-reserve wakes no tab readers", async () => {
    ensureTabReservation("t")
    await flush()
    const before = tabsRevision()
    releaseTabReservation("t")
    ensureTabReservation("t")
    await flush()
    expect(tabsRevision()).toBe(before)
  })

  it("catches up after a reconnect on changes it missed", async () => {
    detach()
    store.apply("t", [{ op: "close", id: "tab-1" }])
    detach = attachTabsTransport(transport())
    await reloadTabs()
    expect(ids(tabsByTask.get("t"))).toEqual(["tab-2", "tab-3"])
  })
})
