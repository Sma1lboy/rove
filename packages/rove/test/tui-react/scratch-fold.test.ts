/**
 * Fold execution: the scratch shell's hosted sessions move under the owning
 * task's next free tab ids and get adopted into its tab state — quietly
 * (adoption never steals the target's active tab), and only when the host
 * actually re-keyed something (a host without rename support, or a dead
 * session, must NOT delete the scratch row over nothing).
 *
 * The target ids come from the daemon's counter (`io.reserve`), so no other
 * client can mint the same ones; with no daemon the fold counts past the
 * target's own tabs. The adoption lands in the daemon's tab store, never the kv.
 */

import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { foldScratchShell } from "../../src/tui-react/workspace/scratch-fold"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync"
import type { TabsSnapshotKv } from "../../src/tui-react/workspace/terminal-tabs-persist"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { scratchOwnerTasks } from "../../src/tui-react/workspace/use-scratch-adopt"
import type { Task } from "../../src/types/task"
import { type TabsSyncDaemon, attachTabsDaemon } from "./tabs-sync-daemon"

const SCRATCH = "01SCRATCHFOLD"
const TARGET = "01TARGETFOLD"

function fakeKv(seed: Record<string, unknown> = {}): TabsSnapshotKv & { writes: string[] } {
  const store: Record<string, unknown> = { ...seed }
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

const oneTab: SharedTabs = {
  tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
  activeId: "tab-1",
  nextOrdinal: 2,
}

/** A daemon reservation that hands out 5, 6, 7, …, recording each request. */
function fakeReserve() {
  const calls: [string, number][] = []
  let next = 5
  return {
    calls,
    reserve: async (taskId: string, count: number) => {
      calls.push([taskId, count])
      return Array.from({ length: count }, () => next++)
    },
  }
}

let daemon: TabsSyncDaemon | null = null

beforeEach(() => resetTabsSyncForTests())

afterEach(() => {
  daemon?.detach()
  daemon = null
})

describe("foldScratchShell", () => {
  it("renames the shell under a tab id the daemon reserved and adopts it there", async () => {
    daemon = await attachTabsDaemon({ [TARGET]: oneTab })
    const kv = fakeKv()
    const { calls, reserve } = fakeReserve()
    const renames: [string, string][] = []
    const folded = await foldScratchShell(
      {
        kv,
        reserve,
        rename: async (from, to) => {
          renames.push([from, to])
          return true
        },
      },
      SCRATCH,
      TARGET,
    )
    // One spare per tab for the bump retry.
    expect(calls).toEqual([[TARGET, 2]])
    expect(renames).toEqual([[`${SCRATCH}::tab-1`, `${TARGET}::tab-5`]])
    expect(folded).toEqual({ activeTabId: "tab-5" })
    expect(ids(daemon.tabs(TARGET))).toEqual(["tab-1", "tab-5"])
    expect(ids(tabsByTask.get(TARGET))).toEqual(["tab-1", "tab-5"])
    // Quiet fold: the target's active tab is untouched.
    expect(tabsByTask.get(TARGET)?.activeId).toBe("tab-1")
    expect(kv.writes).toEqual([])
  })

  it("bumps once past an occupied target key onto the next reserved id, then gives up on that tab", async () => {
    daemon = await attachTabsDaemon({ [TARGET]: oneTab })
    const { reserve } = fakeReserve()
    const tries: string[] = []
    const folded = await foldScratchShell(
      {
        kv: fakeKv(),
        reserve,
        rename: async (_from, to) => {
          tries.push(to)
          return to !== `${TARGET}::tab-5`
        },
      },
      SCRATCH,
      TARGET,
    )
    expect(tries).toEqual([`${TARGET}::tab-5`, `${TARGET}::tab-6`])
    expect(folded).toEqual({ activeTabId: "tab-6" })
    expect(ids(daemon.tabs(TARGET))).toEqual(["tab-1", "tab-6"])

    const tries2: string[] = []
    const none = await foldScratchShell(
      {
        kv: fakeKv(),
        reserve,
        rename: async (_from, to) => {
          tries2.push(to)
          return false
        },
      },
      SCRATCH,
      TARGET,
    )
    // Two tries, then the tab stays put.
    expect(tries2).toHaveLength(2)
    expect(none).toBeNull()
  })

  it("with no daemon (reserve answers null) counts past the target's own tabs, bump included", async () => {
    const kv = fakeKv({ [`terminalTabs.${TARGET}`]: oneTab })
    const renames: string[] = []
    const folded = await foldScratchShell(
      {
        kv,
        reserve: async () => null,
        rename: async (_from, to) => {
          renames.push(to)
          return to !== `${TARGET}::tab-2`
        },
      },
      SCRATCH,
      TARGET,
    )
    expect(renames).toEqual([`${TARGET}::tab-2`, `${TARGET}::tab-3`])
    expect(folded).toEqual({ activeTabId: "tab-3" })
    expect(ids(tabsByTask.get(TARGET))).toEqual(["tab-1", "tab-3"])
    expect(tabsByTask.get(TARGET)?.activeId).toBe("tab-1")
    expect(kv.writes).toEqual([])
  })

  it("answers null when the host moved nothing — the scratch row must stay", async () => {
    daemon = await attachTabsDaemon()
    const kv = fakeKv()
    const folded = await foldScratchShell(
      { kv, reserve: fakeReserve().reserve, rename: async () => false },
      SCRATCH,
      TARGET,
    )
    expect(folded).toBeNull()
    expect(daemon.tabs(TARGET)).toBeUndefined()
    expect(tabsByTask.has(TARGET)).toBe(false)
    expect(kv.writes).toEqual([])
  })

  it("moves every scratch tab, not just the shell", async () => {
    daemon = await attachTabsDaemon({
      [SCRATCH]: {
        tabs: [
          { kind: "command", id: "tab-1", ordinal: 1 },
          { kind: "engine", id: "tab-2", ordinal: 2 },
        ],
        activeId: "tab-1",
        nextOrdinal: 3,
      },
    })
    const { calls, reserve } = fakeReserve()
    const renames: [string, string][] = []
    const folded = await foldScratchShell(
      {
        kv: fakeKv(),
        reserve,
        rename: async (from, to) => {
          renames.push([from, to])
          return true
        },
      },
      SCRATCH,
      TARGET,
    )
    expect(calls).toEqual([[TARGET, 4]])
    expect(renames).toEqual([
      [`${SCRATCH}::tab-1`, `${TARGET}::tab-5`],
      [`${SCRATCH}::tab-2`, `${TARGET}::tab-6`],
    ])
    // The folded shell (the tab the user was watching) is the follow target.
    expect(folded).toEqual({ activeTabId: "tab-5" })
    expect(ids(daemon.tabs(TARGET))).toEqual(["tab-5", "tab-6"])
  })

  // A reservation alone leaves an empty record; the fold's seed must still land.
  it("with the daemon's own reservation, lands the adoption in a target that had no tabs yet", async () => {
    // No `io.reserve`: the real `reserveTabOrdinals` path. The reservation itself creates the
    // target's record (a bumped counter), which must not swallow the adoption that follows.
    daemon = await attachTabsDaemon()
    const folded = await foldScratchShell({ kv: fakeKv(), rename: async () => true }, SCRATCH, TARGET)
    expect(folded).toEqual({ activeTabId: "tab-1" })
    expect(ids(daemon.tabs(TARGET))).toEqual(["tab-1"])
  })
})

describe("scratchOwnerTasks", () => {
  it("keeps main/dir/managed rows, drops scratch and pathless ones", () => {
    const base = { repo: "/r", branch: "", status: "backlog" } as unknown as Task
    const tasks = [
      { ...base, id: "a", kind: "main", worktreePath: "/r" },
      { ...base, id: "b", kind: "task", worktreePath: "/w/b" },
      { ...base, id: "c", kind: "dir", scratch: true, worktreePath: "/home" },
      { ...base, id: "d", kind: "dir", worktreePath: "/r/sub" },
      { ...base, id: "e", kind: "task", worktreePath: "" },
    ] as unknown as Task[]
    expect(scratchOwnerTasks(tasks).map((t) => t.id)).toEqual(["a", "b", "d"])
  })
})
