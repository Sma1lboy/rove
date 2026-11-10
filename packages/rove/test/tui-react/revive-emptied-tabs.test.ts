/**
 * Re-entering a task whose last tab you closed must give it a tab back.
 *
 * `closeTab({ allowEmpty })` lets the last tab go, and `show-workspace`
 * deliberately renders nothing for an empty tab list — mounting TerminalTabs
 * over one would mint a replacement it cannot control. Without a revive that
 * leaves the task reachable but dead: its row is still in the sidebar, and
 * selecting it lands on a blank pane with no way out.
 *
 * `reviveEmptiedTabs` is the missing half, and this pins the states it must and
 * must NOT act on. `terminal-tabs-core.test`-adjacent coverage
 * (tab-close-scratch) locks the pure transition; this locks the kv-facing
 * decision, which is where "never opened" and "opened then emptied" are easy to
 * confuse — they are the same `tabs.length === 0` to a careless reader. The
 * decision reads the daemon's tabs (`tabs-sync.ts`) and the revive is written
 * there; the state.json snapshot is only read before the daemon's tabs load.
 */

import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync.ts"
import { terminalTabsKey } from "../../src/tui-react/workspace/terminal-tabs-persist.ts"
import { reviveEmptiedTabs, tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared.ts"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core.ts"
import { type TabsSyncDaemon, attachTabsDaemon, flushTabs } from "./tabs-sync-daemon.ts"

/** The `TabsSnapshotKv` surface, backed by a plain object; records every write. */
function fakeKv(store: Record<string, unknown> = {}) {
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

const TASK = "task-1"

let daemon: TabsSyncDaemon | null = null

/** A daemon holding `state` as the task's tabs (none = the task never opened tabs). */
async function withDaemon(state?: TabsState): Promise<TabsSyncDaemon> {
  daemon = await attachTabsDaemon(state ? { [TASK]: state as unknown as SharedTabs } : {})
  return daemon
}

beforeEach(() => {
  resetTabsSyncForTests()
})

afterEach(() => {
  daemon?.detach()
  daemon = null
})

describe("reviveEmptiedTabs", () => {
  it("reopens an emptied task as the kind of tab that was closed", async () => {
    const { tabs } = await withDaemon({ tabs: [], activeId: "tab-1", nextOrdinal: 2, reopenAs: { kind: "command" } })
    const kv = fakeKv()

    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh")).toBe(true)
    const revived = tabsByTask.get(TASK)
    expect(revived?.tabs).toHaveLength(1)
    expect(revived?.tabs[0]?.kind).toBe("command")
    await flushTabs()
    // The revive is the daemon's state, not a kv write.
    expect(tabs(TASK)?.tabs.map((tab) => tab.kind)).toEqual(["command"])
    expect(kv.writes).toEqual([])
  })

  it("reopens a pre-reopenAs record as a default engine tab", async () => {
    // The upgrade path: emptied on an older build, so the hint is absent. It
    // must still reopen — a user who updates mid-session should not inherit a
    // task that refuses to open.
    const { tabs } = await withDaemon({ tabs: [], activeId: "tab-1", nextOrdinal: 2 })

    expect(reviveEmptiedTabs(fakeKv(), TASK, "/bin/zsh")).toBe(true)
    expect(tabsByTask.get(TASK)?.tabs[0]?.kind).toBe("engine")
    await flushTabs()
    expect(tabs(TASK)?.tabs.map((tab) => tab.kind)).toEqual(["engine"])
  })

  it.each(["emptied", "never-opened"])("pins the chooser engine and command for a %s task", async (path) => {
    const { tabs } = await withDaemon(
      path === "emptied" ? { tabs: [], activeId: "tab-3", nextOrdinal: 4, reopenAs: { kind: "command" } } : undefined,
    )
    const kv = fakeKv()
    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh", { vendor: "codex", engineCommand: "codex" })).toBe(true)
    const expected = [
      {
        kind: "engine",
        id: path === "emptied" ? "tab-4" : "tab-1",
        ordinal: path === "emptied" ? 4 : 1,
        title: null,
        vendor: "codex",
        engineCommand: "codex",
      },
    ]
    expect(tabsByTask.get(TASK)?.tabs).toEqual(expected)
    await flushTabs()
    expect(tabs(TASK)?.tabs).toEqual(expected)
    expect(tabsByTask.get(TASK)?.tabs).toEqual(expected)
    // The emptied record's re-seed hint is spent once a tab is back.
    expect(tabs(TASK)?.reopenAs).toBeUndefined()
    expect(kv.writes).toEqual([])
  })

  it("leaves a task that still has tabs alone", async () => {
    // The common case by far. Reviving here would add a phantom tab on every
    // single task activation.
    const live: TabsState = {
      tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
      activeId: "tab-1",
      nextOrdinal: 2,
    }
    const { tabs } = await withDaemon(live)

    expect(reviveEmptiedTabs(fakeKv(), TASK, "/bin/zsh")).toBe(false)
    expect(tabs(TASK)?.tabs.map((tab) => tab.id)).toEqual(["tab-1"])
  })

  it("leaves a task that has NEVER opened tabs alone", async () => {
    // `null`, not empty — the distinction the whole empty-state branch rests
    // on. TerminalTabs mounts for this task and mints its own first tab;
    // publishing one here would race that with a second, session-less tab.
    const { tabs } = await withDaemon()

    expect(reviveEmptiedTabs(fakeKv(), TASK, "/bin/zsh")).toBe(false)
    expect(tabsByTask.has(TASK)).toBe(false)
    expect(tabs(TASK)).toBeUndefined()
  })

  it("once the daemon's tabs loaded, ignores a stale state.json snapshot", async () => {
    // The daemon is authoritative; the kv copy is only this process's start-up
    // state. Reading an emptied snapshot here would revive a task that has
    // tabs open right now.
    const { tabs } = await withDaemon({
      tabs: [{ kind: "engine", id: "tab-9", title: null, ordinal: 9 }],
      activeId: "tab-9",
      nextOrdinal: 10,
    })
    const kv = fakeKv({ [terminalTabsKey(TASK)]: { tabs: [], activeId: "tab-1", nextOrdinal: 2 } })

    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh")).toBe(false)
    expect(tabsByTask.get(TASK)?.tabs[0]?.id).toBe("tab-9")
    expect(tabs(TASK)?.tabs.map((tab) => tab.id)).toEqual(["tab-9"])
  })

  it("before the daemon's tabs arrive, revives from the state.json snapshot without writing it", () => {
    // No transport attached: the snapshot this process started with is all
    // there is, and the revive lands in the view only. The kv key belongs to
    // the daemon.
    const kv = fakeKv({ [terminalTabsKey(TASK)]: { tabs: [], activeId: "tab-1", nextOrdinal: 2 } })

    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh")).toBe(true)
    expect(tabsByTask.get(TASK)?.tabs.map((tab) => tab.id)).toEqual(["tab-2"])
    expect(kv.writes).toEqual([])
  })
})
