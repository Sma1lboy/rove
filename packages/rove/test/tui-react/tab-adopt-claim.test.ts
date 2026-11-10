/**
 * Adoption routes through the same claim protocol as tab-close: a mounted
 * `TerminalTabs` owns its task's state, so the background writer must stay
 * out of its way. Both halves writing would clobber the component's React
 * state with a write it never agreed to. Unclaimed, the adoption is a write to
 * the daemon's tab store (`tabs-sync.ts`); the kv is never written.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync"
import { adoptTaskTabs } from "../../src/tui-react/workspace/terminal-tabs-adopt"
import type { TabsSnapshotKv } from "../../src/tui-react/workspace/terminal-tabs-persist"
import { tabActivationListeners, tabsByTask, takeTabAdopt } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type TabsSyncDaemon, attachTabsDaemon, flushTabs } from "./tabs-sync-daemon"

const TASK = "01TESTADOPTCLAIM"

function fakeKv(): TabsSnapshotKv & { writes: string[] } {
  const store: Record<string, unknown> = {}
  const writes: string[] = []
  return {
    store,
    writes,
    set(key: string, value: unknown) {
      writes.push(key)
      store[key] = value
    },
  }
}

const ids = (s: { tabs: readonly { id: string }[] } | null | undefined) => s?.tabs.map((tab) => tab.id)

let daemon: TabsSyncDaemon

beforeEach(async () => {
  resetTabsSyncForTests()
  daemon = await attachTabsDaemon()
})

afterEach(() => {
  daemon.detach()
  tabActivationListeners.clear()
})

describe("adoptTaskTabs", () => {
  it("writes the daemon's tabs when no mounted component claims the task", async () => {
    const kv = fakeKv()
    expect(adoptTaskTabs(kv, TASK, ["tab-4"])).toBe(true)
    expect(ids(tabsByTask.get(TASK))).toEqual(["tab-4"])
    await flushTabs()
    // Adopted under its own id, already running.
    expect(daemon.tabs(TASK)?.tabs).toEqual([{ kind: "engine", id: "tab-4", title: null, ordinal: 4, spawned: true }])
    expect(ids(tabsByTask.get(TASK))).toEqual(["tab-4"])
    expect(kv.writes).toEqual([])
  })

  it("leaves the write to the mounted component when one claims it", async () => {
    const kv = fakeKv()
    const claimed: string[][] = []
    tabActivationListeners.add(() => {
      const ids = takeTabAdopt(TASK)
      if (ids) claimed.push([...ids])
    })
    expect(adoptTaskTabs(kv, TASK, ["tab-4"])).toBe(false)
    expect(claimed).toEqual([["tab-4"]])
    await flushTabs()
    expect(daemon.tabs(TASK)).toBeUndefined()
    expect(kv.writes).toEqual([])
  })

  it("does not write when the tabs are already known — it runs off a poll", async () => {
    const kv = fakeKv()
    adoptTaskTabs(kv, TASK, ["tab-4"])
    await flushTabs()
    const first = daemon.store.get(TASK)
    expect(adoptTaskTabs(kv, TASK, ["tab-4"])).toBe(false)
    await flushTabs()
    expect(daemon.store.get(TASK)).toEqual(first)
  })

  it("never resurrects a tab the daemon already closed (a dying session seen by the poll)", async () => {
    daemon.store.apply(TASK, [
      { op: "seed", state: { tabs: [{ kind: "engine", id: "tab-4", title: null, ordinal: 4 }], nextOrdinal: 5 } },
      { op: "close", id: "tab-4" },
    ])
    await flushTabs()
    expect(adoptTaskTabs(fakeKv(), TASK, ["tab-4"])).toBe(true)
    await flushTabs()
    expect(ids(daemon.tabs(TASK))).toEqual([])
    expect(ids(tabsByTask.get(TASK))).toEqual([])
  })
})
