/**
 * Standalone `kind:"dir"` tasks (`rove .`).
 *
 * Why these matter: a dir task pins the USER'S OWN directory as its
 * worktreePath. Every guarantee here is a data-loss guard — deletion must
 * only ever drop the index entry (never `git worktree remove` the user's
 * directory), no other row may be minted as a side effect, and
 * every open is a NEW task (parallel sessions in one directory) with a
 * randomly-suffixed title so the rows stay distinguishable.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Orchestrator } from "@sma1lboy/rove-core/orchestrator/core.ts"
import { TaskIndexStore } from "@sma1lboy/rove-core/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "@sma1lboy/rove-core/orchestrator/worktree/manager.ts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let home: string
let dir: string
let store: TaskIndexStore
let orch: Orchestrator
let worktrees: {
  dirtyPaths: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  pathExists: ReturnType<typeof vi.fn>
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "rove-dir-task-"))
  dir = await mkdtemp(join(tmpdir(), "rove-user-dir-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  worktrees = {
    dirtyPaths: vi.fn(async () => ["notes.md"]),
    remove: vi.fn(async () => {}),
    pathExists: vi.fn(async () => true),
  }
  orch = new Orchestrator({ store, worktrees: worktrees as unknown as GitWorktreeManager })
})

afterEach(async () => {
  orch.dispose()
  await rm(home, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
})

describe("openDirectoryTask", () => {
  it("creates a project-less dir task pinned to the directory", async () => {
    const task = await orch.openDirectoryTask({ dir })
    expect(task.kind).toBe("dir")
    expect(task.worktreePath).toBe(task.repo)
    expect(task.branch).toBe("")
    expect(orch.listTasks()).toHaveLength(1)
  })

  it("opening the same directory twice creates two distinct tasks with distinct titles", async () => {
    const first = await orch.openDirectoryTask({ dir })
    const second = await orch.openDirectoryTask({ dir })
    expect(second.id).not.toBe(first.id)
    expect(second.title).not.toBe(first.title)
    expect(orch.listTasks()).toHaveLength(2)
  })

  it("ensureWorktree returns the pinned directory without touching git", async () => {
    const task = await orch.openDirectoryTask({ dir })
    await expect(orch.ensureWorktree(task.id)).resolves.toBe(task.worktreePath)
    expect(worktrees.pathExists).not.toHaveBeenCalled()
  })

  it("delete drops the index entry and NEVER removes the directory", async () => {
    const task = await orch.openDirectoryTask({ dir })
    // dirtyPaths reports changes — a dir task must skip the dirty gate entirely
    // (nothing on disk is at risk) and must never call worktrees.remove.
    await orch.deleteTask(task.id)
    expect(orch.getTask(task.id)).toBeUndefined()
    expect(worktrees.dirtyPaths).not.toHaveBeenCalled()
    expect(worktrees.remove).not.toHaveBeenCalled()
  })

  it("refuses landTask and setBranch", async () => {
    const task = await orch.openDirectoryTask({ dir })
    await expect(orch.landTask(task.id)).rejects.toThrow(/directory task/)
    await expect(orch.setBranch(task.id, "x")).rejects.toThrow(/directory task/)
  })
})

describe("No folder sessions", () => {
  it("mint NO auto-name, and a rename keeps them Ungrouped", async () => {
    const task = await orch.openDirectoryTask({ dir, noProject: true })
    expect(task.title).toBe("")
    await orch.setTitle(task.id, "my bench")
    expect(orch.getTask(task.id)).toMatchObject({ title: "my bench", noProject: true })
  })

  it("a routine's no-project session keeps its title, pins, routine link and flag across a reload", async () => {
    const task = await orch.openDirectoryTask({
      dir,
      noProject: true,
      title: "nightly audit",
      model: "opus",
      modelEffort: "high",
      routine: { automationId: "auto-1" },
    })
    const reloaded = new TaskIndexStore({ homeDir: home })
    await reloaded.load()
    expect(reloaded.get(task.id)).toMatchObject({
      kind: "dir",
      noProject: true,
      title: "nightly audit",
      model: "opus",
      modelEffort: "high",
      routine: { automationId: "auto-1" },
    })
  })
})
