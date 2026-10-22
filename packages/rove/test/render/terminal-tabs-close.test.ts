/**
 * `closeTaskTab`'s mounted-vs-background fork.
 *
 * Lives in the bun-run render track (not vitest) because the module reaches
 * the PTY registry and the split helper, which pull in opentui.
 *
 * The fork is the whole point of the module: if BOTH paths ran, a mounted
 * TerminalTabs would write its React state and then have the background write
 * clobber it from underneath; if NEITHER ran, closing a non-selected
 * worktree's tab would silently do nothing.
 *
 * The background close is a write to the daemon's tab store (`tabs-sync.ts`),
 * which persists it; the kv snapshot is the daemon's and is never written here.
 */

import { afterEach, beforeEach, expect, test } from "bun:test"
import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync"
import { closeOtherTaskTabs, closeTaskTab } from "../../src/tui-react/workspace/terminal-tabs-close"
import { terminalTabsKey } from "../../src/tui-react/workspace/terminal-tabs-persist"
import { tabActivationListeners, tabsByTask, takeTabClose } from "../../src/tui-react/workspace/terminal-tabs-shared"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core"
import { type TabsSyncDaemon, attachTabsDaemon, flushTabs } from "../tui-react/tabs-sync-daemon"

function state(ids: readonly string[], activeId = ids[0] ?? "tab-1"): TabsState {
  return {
    tabs: ids.map((id, i) => ({ kind: "engine" as const, id, title: null, ordinal: i + 1, vendor: "claude" as const })),
    activeId,
    nextOrdinal: ids.length + 1,
  }
}

/** Minimal stand-in for the KV context the host passes in; records every write. */
function fakeKv() {
  const store: Record<string, unknown> = {}
  const writes: string[] = []
  return {
    store,
    set(key: string, value: unknown) {
      writes.push(key)
      store[key] = value
    },
    writes,
  }
}

let daemon: TabsSyncDaemon | null = null

/** A daemon holding these tasks' tabs, attached and loaded. */
async function withDaemon(tasks: Record<string, TabsState>): Promise<TabsSyncDaemon> {
  daemon = await attachTabsDaemon(tasks as unknown as Record<string, SharedTabs>)
  return daemon
}

const ids = (s: { tabs: readonly { id: string }[] } | null | undefined) => s?.tabs.map((tab) => tab.id)

beforeEach(() => resetTabsSyncForTests())

afterEach(() => {
  daemon?.detach()
  daemon = null
})

test("no mounted owner: the background path writes the view and the daemon, never the kv", async () => {
  const { tabs } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
  const kv = fakeKv()

  expect(closeTaskTab(kv, "t1", "tab-2")).toBe(true)

  expect(ids(tabsByTask.get("t1"))).toEqual(["tab-1"])
  await flushTabs()
  // The daemon's copy must move too, or a restart (or another client) resurrects the closed tab.
  expect(ids(tabs("t1"))).toEqual(["tab-1"])
  expect(ids(tabsByTask.get("t1"))).toEqual(["tab-1"])
  expect(kv.writes).toEqual([])
})

test("closing the ACTIVE tab moves activeId to a surviving one", async () => {
  await withDaemon({ t1: state(["tab-1", "tab-2"], "tab-2") })
  expect(closeTaskTab(fakeKv(), "t1", "tab-2")).toBe(true)
  await flushTabs()
  expect(tabsByTask.get("t1")?.activeId).toBe("tab-1")
})

test("a mounted owner claims the request, and the background write does NOT also run", async () => {
  const { store } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
  const before = tabsByTask.get("t1")
  const daemonBefore = store.get("t1")
  const claimed: string[] = []
  const listener = () => {
    const id = takeTabClose("t1")
    if (id) claimed.push(id)
  }
  tabActivationListeners.add(listener)
  try {
    expect(closeTaskTab(fakeKv(), "t1", "tab-2")).toBe(true)
  } finally {
    tabActivationListeners.delete(listener)
  }

  expect(claimed).toEqual(["tab-2"])
  await flushTabs()
  // Untouched: the mounted component owns the write. A background write here
  // would race the component's own setState.
  expect(tabsByTask.get("t1")).toBe(before)
  expect(store.get("t1")).toEqual(daemonBefore)
})

test("the last tab closes, leaving the task empty", async () => {
  // A task's last tab may go: the row stays and is revived on re-entry. The
  // mounted and background routes are the SAME gesture from the tree, so both
  // have to allow it — a refusal left on either one is invisible from the
  // other.
  const { tabs } = await withDaemon({ t1: state(["tab-1"]) })
  expect(closeTaskTab(fakeKv(), "t1", "tab-1")).toBe(true)
  await flushTabs()
  expect(tabsByTask.get("t1")?.tabs).toHaveLength(0)
  expect(tabs("t1")?.tabs).toHaveLength(0)
})

test("an unknown task reports failure", async () => {
  // The one remaining false: nothing to close. Kept separate from the case
  // above so a regression there cannot hide behind this one.
  await withDaemon({})
  expect(closeTaskTab(fakeKv(), "never-mounted", "tab-1")).toBe(false)
})

test("once the daemon's tabs loaded, a stale state.json snapshot is not consulted", async () => {
  // The snapshot is only this process's start-up copy; a task that gained a tab
  // since must not be closed against the older list.
  const { tabs } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
  const kv = fakeKv()
  kv.store[terminalTabsKey("t1")] = state(["tab-1"])
  expect(closeTaskTab(kv, "t1", "tab-2")).toBe(true)
  await flushTabs()
  expect(ids(tabs("t1"))).toEqual(["tab-1"])
  expect(kv.writes).toEqual([])
})

test("a mounted task does not claim a tab id it does not have", async () => {
  await withDaemon({ t1: state(["tab-1"]) })
  const claimed: string[] = []
  const listener = () => {
    const id = takeTabClose("t1")
    if (id) claimed.push(id)
  }
  tabActivationListeners.add(listener)
  try {
    expect(closeTaskTab(fakeKv(), "t1", "tab-9")).toBe(false)
  } finally {
    tabActivationListeners.delete(listener)
  }
  expect(claimed).toEqual([])
})

test("before the daemon's tabs arrive, a task with only a restart snapshot still closes (in the view)", () => {
  // The tree lists tabs for worktrees that have not mounted since restart; with
  // no daemon answer yet those come from the state.json copy, which stays the
  // daemon's to write.
  const kv = fakeKv()
  kv.store[terminalTabsKey("t9")] = state(["tab-1", "tab-2"])
  expect(closeTaskTab(kv, "t9", "tab-1")).toBe(true)
  expect(ids(tabsByTask.get("t9"))).toEqual(["tab-2"])
  expect(kv.writes).toEqual([])
})

test("closing the other tabs keeps only the named one, active, in the view and the daemon", async () => {
  const { tabs } = await withDaemon({ t1: state(["tab-1", "tab-2", "tab-3"], "tab-1") })
  const kv = fakeKv()
  expect(closeOtherTaskTabs(kv, "t1", "tab-2")).toBe(2)
  await flushTabs()
  expect(ids(tabsByTask.get("t1"))).toEqual(["tab-2"])
  expect(tabsByTask.get("t1")?.activeId).toBe("tab-2")
  expect(ids(tabs("t1"))).toEqual(["tab-2"])
  expect(kv.writes).toEqual([])
})

test("closing the other tabs of a stale tab id closes nothing", async () => {
  // The row went away between the right-click and the confirm.
  const { tabs } = await withDaemon({ t1: state(["tab-1", "tab-2"]) })
  expect(closeOtherTaskTabs(fakeKv(), "t1", "tab-9")).toBe(0)
  await flushTabs()
  expect(ids(tabsByTask.get("t1"))).toEqual(["tab-1", "tab-2"])
  expect(ids(tabs("t1"))).toEqual(["tab-1", "tab-2"])
})
