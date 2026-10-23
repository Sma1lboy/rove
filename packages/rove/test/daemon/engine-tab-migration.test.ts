import { describe, expect, it } from "vitest"
import type { DaemonOrchestrator, DaemonTask, MigratedChildInput } from "../../../rove-daemon/src/daemon/contracts.ts"
import { migrateEngineTabs } from "../../../rove-daemon/src/daemon/engine-tab-migration.ts"
import type { SharedTabs, TabRow } from "../../../rove-daemon/src/daemon/tabs-ops.ts"
import { TabsStore } from "../../../rove-daemon/src/daemon/tabs-store.ts"

const engine = (id: string, extra: Record<string, unknown> = {}): TabRow => ({
  id,
  ordinal: Number(id.slice(4)),
  kind: "engine",
  ...extra,
})

function parentTask(): DaemonTask {
  return {
    id: "parent",
    title: "parent",
    repo: "/repo",
    branch: "b",
    worktreePath: "/wt/parent",
    kind: "task",
    status: "in_progress",
  } as unknown as DaemonTask
}

/** An orchestrator that only knows the rows the migration reads and creates. */
function rig(tabsOf: readonly TabRow[], hostSessions: { key: string; alive: boolean; restored?: boolean }[]) {
  const tasks: DaemonTask[] = [parentTask()]
  const orch = {
    listTasks: () => tasks,
    createMigratedChild: async (input: MigratedChildInput) => {
      const child = {
        ...parentTask(),
        id: `child-${tasks.length}`,
        parentTaskId: input.parentTaskId,
        sharesWorkspaceOf: input.parentTaskId,
        title: input.title,
        ...(input.vendor ? { vendor: input.vendor } : {}),
        ...(input.command ? { command: input.command } : {}),
        ...(input.ptyAlias ? { ptyAlias: input.ptyAlias } : {}),
      } as unknown as DaemonTask
      tasks.push(child)
      return child
    },
  } satisfies Pick<DaemonOrchestrator, "listTasks" | "createMigratedChild">
  const tabs = new TabsStore(undefined, { publish: () => {} })
  tabs.apply("parent", [
    { op: "seed", state: { tabs: tabsOf, nextOrdinal: 10, activeId: "tab-2" } satisfies SharedTabs },
  ])
  const log: string[] = []
  return {
    tasks,
    tabs,
    log,
    run: (sessions = hostSessions) => migrateEngineTabs({ orch, tabs, log: (line) => log.push(line) }, sessions),
    ids: (taskId: string) => tabs.get(taskId).state?.tabs.map((t) => t.id),
  }
}

describe("migrating extra engine tabs into child tasks", () => {
  it("aliases a tab whose PTY is live, leaving the PTY keyed where it is and the shell tab on the parent", async () => {
    const r = rig(
      [
        engine("tab-1", { sessionId: "s1", spawned: true }),
        engine("tab-2", { title: "second", vendor: "codex", sessionId: "s2", spawned: true, lastTitle: "x" }),
        { id: "tab-3", ordinal: 3, kind: "command", command: ["zsh"] },
      ],
      [
        { key: "parent::tab-1", alive: true },
        { key: "parent::tab-2", alive: true },
      ],
    )

    expect(await r.run()).toEqual({ aliased: 1, resumable: 0, dropped: 0 })

    const child = r.tasks[1] as DaemonTask
    expect(child).toMatchObject({
      parentTaskId: "parent",
      sharesWorkspaceOf: "parent",
      title: "second",
      vendor: "codex",
      ptyAlias: { taskId: "parent", tabId: "tab-2" },
    })
    // The conversation stays on `tab-2`'s PTY: the child's own tab views it and nothing is respawned.
    expect(r.tabs.get(child.id).state?.tabs).toEqual([
      expect.objectContaining({
        id: "tab-2",
        kind: "engine",
        sessionId: "s2",
        spawned: true,
        ptyTask: { id: "parent", worktree: "/wt/parent", tabId: "tab-2" },
      }),
    ])
    expect(r.ids("parent")).toEqual(["tab-1", "tab-3"])
    expect(r.tabs.get("parent").state?.activeId).toBe("tab-1")
  })

  it("turns a dead tab with a session into a child whose tab-1 resumes it, and drops one with nothing to resume", async () => {
    const r = rig(
      [
        engine("tab-1"),
        engine("tab-2", { sessionId: "s2", spawned: true, engineCommand: "claudecpa" }),
        engine("tab-3"),
        engine("tab-4", { sessionId: "s4", spawned: true }),
      ],
      [
        { key: "parent::tab-1", alive: true },
        // A freeze-restored corpse is as dead as an absent session.
        { key: "parent::tab-4", alive: true, restored: true },
      ],
    )

    expect(await r.run()).toEqual({ aliased: 0, resumable: 2, dropped: 1 })

    const [, resumed, restored] = r.tasks
    expect(resumed).toMatchObject({ command: "claudecpa" })
    expect(resumed?.ptyAlias).toBeUndefined()
    expect(r.tabs.get(resumed?.id as string).state?.tabs).toEqual([
      expect.objectContaining({ id: "tab-1", kind: "engine", sessionId: "s2", spawned: true }),
    ])
    expect(r.tabs.get(restored?.id as string).state?.tabs[0]).toMatchObject({ sessionId: "s4" })
    expect(r.ids("parent")).toEqual(["tab-1"])
    expect(r.log.some((line) => line.includes("tab-3 dropped"))).toBe(true)
  })

  it("is a no-op the second time, and resumes after a crash without minting a second child", async () => {
    const r = rig(
      [engine("tab-1"), engine("tab-2", { sessionId: "s2" })],
      [
        { key: "parent::tab-1", alive: true },
        { key: "parent::tab-2", alive: true },
      ],
    )
    await r.run()
    expect(await r.run()).toEqual({ aliased: 0, resumable: 0, dropped: 0 })
    expect(r.tasks).toHaveLength(2)

    // The child row exists but the parent's tab was never closed: found by its alias, not re-created.
    const crashed = rig(
      [engine("tab-1"), engine("tab-2", { sessionId: "s2" })],
      [
        { key: "parent::tab-1", alive: true },
        { key: "parent::tab-2", alive: true },
      ],
    )
    crashed.tasks.push({
      ...parentTask(),
      id: "early",
      parentTaskId: "parent",
      ptyAlias: { taskId: "parent", tabId: "tab-2" },
    } as unknown as DaemonTask)
    await crashed.run()
    expect(crashed.tasks).toHaveLength(2)
    expect(crashed.ids("parent")).toEqual(["tab-1"])
    expect(crashed.ids("early")).toEqual(["tab-2"])
  })

  it("changes nothing while the PTY host cannot be read, and never counts a viewport tab as a conversation", async () => {
    const r = rig([engine("tab-1"), engine("tab-2", { sessionId: "s2" })], [])
    expect(await r.run(null as never)).toEqual({ aliased: 0, resumable: 0, dropped: 0 })
    expect(r.ids("parent")).toEqual(["tab-1", "tab-2"])

    const viewport = rig([engine("tab-1"), engine("tab-2", { ptyTask: { id: "other", worktree: "/wt/other" } })], [])
    await viewport.run()
    expect(viewport.tasks).toHaveLength(1)
    expect(viewport.ids("parent")).toEqual(["tab-1", "tab-2"])
  })
})
