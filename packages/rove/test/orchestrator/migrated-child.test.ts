import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Orchestrator } from "@sma1lboy/rove-core/orchestrator/core.ts"
import { TaskIndexStore } from "@sma1lboy/rove-core/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "@sma1lboy/rove-core/orchestrator/worktree/manager.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

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

  it("is stored as a dir row sharing a dir parent's checkout", async () => {
    const dir = await parentRow("dir")
    const child = await orch.createMigratedChild({ parentTaskId: dir.id, title: "second" })
    expect(child).toMatchObject({ kind: "dir", branch: "", sharesWorkspaceOf: dir.id })
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

  it("hangs a tab migrated out of a child under the child's parent, in the child's directory", async () => {
    const root = await parentRow("task")
    const child = await orch.createMigratedChild({ parentTaskId: root.id, title: "child" })

    const sibling = await orch.createMigratedChild({ parentTaskId: child.id, title: "from child" })

    expect(sibling).toMatchObject({ parentTaskId: root.id, sharesWorkspaceOf: root.id, worktreePath: "/wt/parent" })
  })
})
