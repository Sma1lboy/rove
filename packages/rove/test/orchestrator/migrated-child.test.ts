import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"

let home: string
let store: TaskIndexStore
let orch: Orchestrator

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "rove-migrated-child-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  // Any git call would throw: a boot-time migration must never touch a worktree.
  orch = new Orchestrator({ store, worktrees: {} as unknown as GitWorktreeManager })
})

afterEach(async () => {
  orch.dispose()
  await rm(home, { recursive: true, force: true })
})

const parentRow = (kind: Task["kind"]): Promise<Task> =>
  store.create({
    repo: "/repo",
    title: "parent",
    branch: kind === "task" ? "feat/x" : "",
    worktreePath: "/wt/parent",
    status: "in_progress",
    kind,
    vendor: "claude",
    command: "claudecpa",
  })

describe("createMigratedChild", () => {
  it("shares a managed parent's directory and branch, and runs what the tab ran", async () => {
    const parent = await parentRow("task")

    const inherited = await orch.createMigratedChild({ parentTaskId: parent.id, title: "second" })
    expect(inherited).toMatchObject({
      kind: "task",
      branch: "feat/x",
      worktreePath: "/wt/parent",
      parentTaskId: parent.id,
      sharesWorkspaceOf: parent.id,
      command: "claudecpa",
    })

    const pinned = await orch.createMigratedChild({
      parentTaskId: parent.id,
      title: "third",
      vendor: "codex",
      ptyAlias: { taskId: parent.id, tabId: "tab-3" },
    })
    expect(pinned).toMatchObject({ vendor: "codex", ptyAlias: { taskId: parent.id, tabId: "tab-3" } })
    expect(pinned.command).toBeUndefined()
  })

  it("is stored as a dir row under a main or dir parent, so it never counts as a second main", async () => {
    const main = await parentRow("main")
    const child = await orch.createMigratedChild({ parentTaskId: main.id, title: "second" })
    expect(child).toMatchObject({ kind: "dir", branch: "", sharesWorkspaceOf: main.id })
  })

  it("clears the alias once, durably", async () => {
    const parent = await parentRow("task")
    const child = await orch.createMigratedChild({
      parentTaskId: parent.id,
      title: "second",
      ptyAlias: { taskId: parent.id, tabId: "tab-2" },
    })

    await orch.setPtyAlias(child.id, null)

    const reloaded = new TaskIndexStore({ homeDir: home })
    await reloaded.load()
    expect(reloaded.get(child.id)?.ptyAlias).toBeUndefined()
  })
})
