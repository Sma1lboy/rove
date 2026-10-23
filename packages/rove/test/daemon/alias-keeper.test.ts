import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { DaemonActivityRegistry } from "../../../rove-daemon/src/daemon/activity-registry.ts"
import { AliasKeeper } from "../../../rove-daemon/src/daemon/alias-keeper.ts"
import type { DaemonOrchestrator, DaemonTask, TaskPtyAlias } from "../../../rove-daemon/src/daemon/contracts.ts"
import { DaemonEventBus } from "../../../rove-daemon/src/daemon/event-bus.ts"
import { recordPtyExit } from "../../../rove-daemon/src/daemon/pty-exit-store.ts"
import { startPtyExitWatch } from "../../../rove-daemon/src/daemon/pty-exit-watch.ts"
import { TabsStore } from "../../../rove-daemon/src/daemon/tabs-store.ts"

function rig(deps: { now?: () => number } = {}) {
  const child = {
    id: "child",
    title: "child",
    repo: "/repo",
    branch: "b",
    worktreePath: "/wt",
    kind: "task",
    status: "backlog",
    parentTaskId: "parent",
    sharesWorkspaceOf: "parent",
    ptyAlias: { taskId: "parent", tabId: "tab-2" },
  } as unknown as DaemonTask
  const tasks = [child]
  const orch = {
    listTasks: () => tasks,
    setPtyAlias: async (_id: string, alias: TaskPtyAlias | null) => {
      tasks[0] = { ...tasks[0], ptyAlias: alias ?? undefined } as DaemonTask
    },
  } satisfies Pick<DaemonOrchestrator, "listTasks" | "setPtyAlias">
  const tabs = new TabsStore(undefined, { publish: () => {} })
  tabs.apply("child", [
    {
      op: "seed",
      state: {
        tabs: [
          {
            id: "tab-2",
            ordinal: 2,
            kind: "engine",
            title: "second",
            sessionId: "s2",
            spawned: true,
            ptyTask: { id: "parent", worktree: "/wt", tabId: "tab-2" },
          },
        ],
        nextOrdinal: 3,
        activeId: "tab-2",
      },
    },
  ])
  const keeper = new AliasKeeper({ orch, tabs, log: () => {}, ...deps })
  return { tasks, tabs, keeper }
}

describe("a migrated child outliving its PTY", () => {
  it("keeps the alias while the PTY is alive", async () => {
    const r = rig()
    await r.keeper.reconcile([{ key: "parent::tab-2", alive: true }])
    expect(r.tasks[0]?.ptyAlias).toEqual({ taskId: "parent", tabId: "tab-2" })
    expect(r.tabs.get("child").state?.tabs.map((t) => t.id)).toEqual(["tab-2"])
  })

  it("becomes an ordinary child that resumes its session in its own tab-1", async () => {
    const r = rig()
    // Gone from the host, and a freeze-restored corpse, both end the alias.
    await r.keeper.reconcile([{ key: "parent::tab-2", alive: true, restored: true }])

    expect(r.tasks[0]?.ptyAlias).toBeUndefined()
    const state = r.tabs.get("child").state
    expect(state?.tabs).toEqual([
      { id: "tab-1", ordinal: 1, kind: "engine", title: "second", sessionId: "s2", spawned: true },
    ])
    expect(state?.activeId).toBe("tab-1")
  })

  it("keeps the session id when the TUI closed the tab before the death was noticed", async () => {
    const r = rig()
    await r.keeper.reconcile([{ key: "parent::tab-2", alive: true }])
    r.tabs.apply("child", [{ op: "close", id: "tab-2" }])

    await r.keeper.reconcile([])

    expect(r.tasks[0]?.ptyAlias).toBeUndefined()
    expect(r.tabs.get("child").state?.tabs).toEqual([
      expect.objectContaining({ id: "tab-1", kind: "engine", sessionId: "s2", spawned: true }),
    ])
  })
})

describe("who a report about an aliased PTY speaks for", () => {
  it("is the child while aliased, and for a death that predates the release afterwards", async () => {
    const r = rig()
    expect(r.keeper.ownerOf("parent", "tab-2")).toBe("child")

    const before = Date.now() - 1_000
    await r.keeper.reconcile([])

    expect(r.keeper.ownerOf("parent", "tab-2", before)).toBe("child")
    // No event time, a later tab that reuses the key, or another tab: the parent's own.
    expect(r.keeper.ownerOf("parent", "tab-2")).toBe("parent")
    expect(r.keeper.ownerOf("parent", "tab-2", Date.now() + 60_000)).toBe("parent")
    expect(r.keeper.ownerOf("parent", "tab-1", before)).toBe("parent")
  })

  it("forgets a release after a while", async () => {
    let now = 1_000_000
    const r = rig({ now: () => now })
    await r.keeper.reconcile([])
    expect(r.keeper.ownerOf("parent", "tab-2", now - 1)).toBe("child")

    now += 11 * 60_000
    r.tasks[0] = { ...r.tasks[0], ptyAlias: { taskId: "parent", tabId: "tab-9" } } as DaemonTask
    await r.keeper.reconcile([])
    expect(r.keeper.ownerOf("parent", "tab-2", now - 1)).toBe("parent")
  })

  it("books a death record that lands after the session poll released the alias to the child", async () => {
    const r = rig()
    const bus = new DaemonEventBus()
    const activity = new DaemonActivityRegistry(bus)
    const dead: Array<{ taskId: string; tabId?: string; state: string }> = []
    bus.onPublish((event) => {
      if (event.channel === "engine-state") dead.push(event.payload as (typeof dead)[number])
    })
    const dir = mkdtempSync(join(tmpdir(), "rove-alias-release-"))
    const path = join(dir, "pty-exits.json")
    const stop = startPtyExitWatch({
      path,
      plugins: () => ({ handleUiReport: () => {} }),
      activity,
      ownerOf: (taskId, tabId, at) => r.keeper.ownerOf(taskId, tabId, at),
    })
    try {
      // The poll sees the PTY gone first; the debounced record arrives after.
      await r.keeper.reconcile([])
      const exitedAt = new Date(Date.now() - 5_000).toISOString()
      recordPtyExit(
        { key: "parent::tab-2", pid: 42, exit: { code: 1, signal: null, at: exitedAt }, tail: "boom\n" },
        path,
      )

      await vi.waitFor(() => expect(dead.some((e) => e.state === "dead")).toBe(true), { timeout: 5_000 })
      // The parent is never badged for the child's death.
      expect(dead.filter((e) => e.state === "dead").every((e) => e.taskId === "child")).toBe(true)
    } finally {
      stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
