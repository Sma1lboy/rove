import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import { buildRows } from "../../src/tui/panes/sidebar/groups.ts"

describe("Orchestrator active task recency", () => {
  let home: string
  let orch: Orchestrator

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "rove-active-task-"))
    // Isolate the global `lastActive` record (state/last-active.ts writes
    // through kvStatePath(), which honours ROVE_HOME_DIR).
    vi.stubEnv("ROVE_HOME_DIR", home)
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()
    orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    orch.dispose()
    await rm(home, { recursive: true, force: true })
  })

  // A click must never move a row: `recent` ranks by creation, which neither focus
  // nor bookkeeping writes (a first open, a rename) can change.
  it("`recent` order survives focusing and renaming tasks", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    const a = await orch.createTask({ repo: "/repo", title: "a", branch: "a", vendor: "claude" })
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"))
    const b = await orch.createTask({ repo: "/repo", title: "b", branch: "b", vendor: "claude" })
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"))
    const c = await orch.createTask({ repo: "/repo", title: "c", branch: "c", vendor: "claude" })
    const ours = new Set<string>([a.id, b.id, c.id])
    // createTask also provisions the repo's `main` row; only the three tasks matter here.
    const order = () =>
      buildRows(orch.listTasks(), "", "recent")
        .map((r) => String(r.task.id))
        .filter((id) => ours.has(id))

    expect(order()).toEqual([c.id, b.id, a.id])

    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"))
    await orch.setActiveTask(a.id)
    vi.setSystemTime(new Date("2026-01-01T00:00:11.000Z"))
    await orch.setActiveTask(b.id)
    expect(order()).toEqual([c.id, b.id, a.id])

    vi.setSystemTime(new Date("2026-01-01T00:00:20.000Z"))
    await orch.setTitle(a.id, "a renamed")
    expect(order()).toEqual([c.id, b.id, a.id])
  })

  // The `lastActive` contract (state/last-active.ts): whoever focused last
  // wins globally, and a fresh orchestrator (daemon restart, new `rove`)
  // opens on that task instead of null → "first in the list".
  it("restores the persisted lastActive focus in a fresh orchestrator", async () => {
    const task = await orch.createTask({ repo: "/repo", title: "t", branch: "t", vendor: "claude" })
    await orch.setActiveTask(task.id)

    const store2 = new TaskIndexStore({ homeDir: home })
    await store2.load()
    const orch2 = new Orchestrator({ store: store2, worktrees: new GitWorktreeManager() })
    expect(orch2.activeTaskSignal()()).toBe(task.id)
    orch2.dispose()
  })

  it("drops a persisted lastActive whose task no longer exists", async () => {
    const task = await orch.createTask({ repo: "/repo", title: "t", branch: "t", vendor: "claude" })
    await orch.setActiveTask(task.id)
    await orch.deleteTask(task.id)

    const store2 = new TaskIndexStore({ homeDir: home })
    await store2.load()
    const orch2 = new Orchestrator({ store: store2, worktrees: new GitWorktreeManager() })
    expect(orch2.activeTaskSignal()()).toBeNull()
    orch2.dispose()
  })
})
