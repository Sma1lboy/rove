/** `moveProject`: a project, main checkout or not, moves as one block of the store order the rail reads. */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

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

  it("moves a project with no main checkout as one block, its own order kept", async () => {
    await row("/a", "a", { kind: "main" })
    await row("/b", "b", { kind: "main" })
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
})
