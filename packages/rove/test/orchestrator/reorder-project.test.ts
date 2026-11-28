/** `moveProject`: a project moves as one block of the store order the rail reads. */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Orchestrator } from "@sma1lboy/rove-core/orchestrator/core.ts"
import { TaskIndexStore } from "@sma1lboy/rove-core/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "@sma1lboy/rove-core/orchestrator/worktree/manager.ts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let home: string
let store: TaskIndexStore
let orch: Orchestrator

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "rove-reorder-project-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  orch = new Orchestrator({ store, worktrees: {} as unknown as GitWorktreeManager })
})

afterEach(async () => {
  orch.dispose()
  await rm(home, { recursive: true, force: true })
})

describe("moveProject", () => {
  const row = (repo: string, title: string, extra: Record<string, unknown> = {}) =>
    store.create({ repo, title, branch: "", worktreePath: repo, status: "backlog", vendor: "claude", ...extra })
  // The rail places a project at its first task in the store.
  const projectOrder = (tasks = orch.listTasks()) => [...new Set(tasks.filter((t) => !t.scratch).map((t) => t.repo))]

  it("moves a project as one block, its own order kept", async () => {
    await row("/a", "a", { kind: "dir" })
    await row("/b", "b", { kind: "dir" })
    await row("/dir", "d1", { kind: "dir" })
    await row("/a", "a-task")
    await row("/dir", "d2", { kind: "dir" })
    const scratch = await row("/dir", "scratch", { kind: "dir", scratch: true })

    await orch.moveProject("/dir", "/a", "before")
    expect(projectOrder()).toEqual(["/dir", "/a", "/b"])
    expect(
      orch
        .listTasks()
        .filter((t) => t.repo === "/dir" && !t.scratch)
        .map((t) => t.title),
    ).toEqual(["d1", "d2"])
    // A Scratch row on the same path belongs to no project and stays where it was.
    expect(orch.listTasks().at(-1)?.id).toBe(scratch.id)

    await orch.moveProject("/dir", "/a", "after")
    // /a's tasks are interleaved with /b's (a-task came after b); "after /a" still lands before /b.
    expect(projectOrder()).toEqual(["/a", "/dir", "/b"])

    await orch.moveProject("/dir", "/b", "after")
    expect(projectOrder()).toEqual(["/a", "/b", "/dir"])
    const reread = new TaskIndexStore({ homeDir: home })
    await reread.load()
    expect(projectOrder(reread.list())).toEqual(["/a", "/b", "/dir"])
  })

  it("a project keeps its place when its first task is archived or deleted", async () => {
    const first = await row("/a", "a1", { kind: "dir" })
    await row("/b", "b", { kind: "dir" })
    const second = await row("/a", "a2", { kind: "dir" })
    await row("/a", "a3", { kind: "dir" })
    const listed = () => projectOrder(orch.listTasks().filter((t) => !t.archived && !t.deletion))

    await orch.setArchived(first.id, true)
    expect(listed()).toEqual(["/a", "/b"])

    await orch.deleteTask(second.id, { force: true })
    expect(listed()).toEqual(["/a", "/b"])
  })
})
