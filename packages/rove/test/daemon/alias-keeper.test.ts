import { describe, expect, it } from "vitest"
import { AliasKeeper } from "../../../rove-daemon/src/daemon/alias-keeper.ts"
import type { DaemonOrchestrator, DaemonTask, TaskPtyAlias } from "../../../rove-daemon/src/daemon/contracts.ts"
import { TabsStore } from "../../../rove-daemon/src/daemon/tabs-store.ts"

function rig() {
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
  const keeper = new AliasKeeper({ orch, tabs, log: () => {} })
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
