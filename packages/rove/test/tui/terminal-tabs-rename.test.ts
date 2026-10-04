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
 * does. The CLI writes the persisted snapshot AND broadcasts, so both writers
 * run — and a second write that returns the same object costs no re-render
 * and no second persist.
 */

import { afterEach, describe, expect, it } from "vitest"
import type { TabsSnapshotKv } from "../../src/tui-react/workspace/terminal-tabs-persist.ts"
import { renameTaskTab } from "../../src/tui-react/workspace/terminal-tabs-rename.ts"
import {
  tabActivationListeners,
  tabsByTask,
  takeTabRename,
} from "../../src/tui-react/workspace/terminal-tabs-shared.ts"
import { type TabsState, rehydrateTabs, setTabTitle } from "../../src/tui/workspace/terminal-tabs-core.ts"

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
  afterEach(() => tabsByTask.clear())

  function kvStub(): TabsSnapshotKv & { writes: Array<[string, unknown]> } {
    const writes: Array<[string, unknown]> = []
    return { store: {}, writes, set: (key, value) => void writes.push([key, value]) }
  }

  it("writes the module map and kv snapshot when no component owns the task", () => {
    const kv = kvStub()
    tabsByTask.set("t1", state(["tab-1", "tab-2"]))
    expect(renameTaskTab(kv, "t1", "tab-2", "e2e")).toBe(true)
    expect(titleOf(tabsByTask.get("t1") as TabsState, "tab-2")).toBe("e2e")
    expect(kv.writes.map(([key]) => key)).toEqual(["terminalTabs.t1"])
  })

  it("reads the kv snapshot for a task not in the module map", () => {
    const kv = kvStub()
    kv.store["terminalTabs.t2"] = state(["tab-1"])
    expect(renameTaskTab(kv, "t2", "tab-1", "logs")).toBe(true)
    expect(titleOf(tabsByTask.get("t2") as TabsState, "tab-1")).toBe("logs")
  })

  it("returns false for a tab the task does not have, and for a task with no tabs", () => {
    // Checked BEFORE publishing, so an unknown id can never report success
    // for a rename that made no transition.
    const kv = kvStub()
    tabsByTask.set("t1", state(["tab-1"]))
    expect(renameTaskTab(kv, "t1", "tab-9", "x")).toBe(false)
    expect(renameTaskTab(kv, "ghost", "tab-1", "x")).toBe(false)
    expect(kv.writes).toEqual([])
  })

  it("re-applying the same name writes NOTHING but still reports the state holds", () => {
    // The CLI writes the snapshot then broadcasts, so this path routinely
    // runs against a tab that already carries the title.
    const kv = kvStub()
    tabsByTask.set("t1", setTabTitle(state(["tab-1"]), "tab-1", "logs"))
    expect(renameTaskTab(kv, "t1", "tab-1", "logs")).toBe(true)
    expect(kv.writes).toEqual([])
  })

  it("a mounted claimant owns the write — background touches nothing", () => {
    // Same claim protocol as closeTaskTab/moveTaskTab: a listener that
    // consumes the request stands in for the mounted TerminalTabs, which
    // renames through its own state writer (and persists there).
    const kv = kvStub()
    const s = state(["tab-1", "tab-2"])
    tabsByTask.set("t1", s)
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
    expect(tabsByTask.get("t1")).toBe(s)
    expect(kv.writes).toEqual([])
  })
})
