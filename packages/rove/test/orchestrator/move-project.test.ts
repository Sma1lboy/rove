/**
 * Moving a task to another project (`update --project`) regroups the rows only: the checkout and branch stay
 * put, and anything git-side (delete, land) still runs in the repo that cut the worktree.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeMainRepo } from "../../src/orchestrator/core-helpers.ts"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"

let home: string
let repoA: string
let repoB: string
let store: TaskIndexStore
let orch: Orchestrator
const worktrees = {
  dirtyPaths: vi.fn(async () => [] as string[]),
  remove: vi.fn(async () => {}),
  pathExists: vi.fn(async () => true),
  ignoredWork: vi.fn(async () => [] as string[]),
}

async function seedMain(repo: string): Promise<string> {
  const { repo: normalized } = normalizeMainRepo(repo)
  await store.create({
    kind: "main",
    title: "main",
    repo: normalized,
    branch: "",
    worktreePath: normalized,
    status: "backlog",
  })
  return normalized
}

async function seedWorktreeTask(repo: string, extra: Partial<Task> = {}): Promise<Task> {
  return store.create({
    kind: "task",
    title: "work",
    repo,
    branch: "feat/x",
    worktreePath: join(home, "worktrees", "x"),
    status: "in_progress",
    ...extra,
  })
}

beforeEach(async () => {
  worktrees.remove.mockClear()
  home = await mkdtemp(join(tmpdir(), "rove-move-home-"))
  repoA = await mkdtemp(join(tmpdir(), "rove-move-a-"))
  repoB = await mkdtemp(join(tmpdir(), "rove-move-b-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  orch = new Orchestrator({ store, worktrees: worktrees as unknown as GitWorktreeManager })
  repoA = await seedMain(repoA)
  repoB = await seedMain(repoB)
})

afterEach(async () => {
  orch.dispose()
  for (const dir of [home, repoA, repoB]) await rm(dir, { recursive: true, force: true })
})

describe("moveTaskToProject", () => {
  it("regroups a worktree task and its children, leaving worktree and branch alone, and delete still runs in the origin repo", async () => {
    const task = await seedWorktreeTask(repoA)
    const child = await seedWorktreeTask(repoA, {
      title: "child",
      branch: "feat/child",
      worktreePath: join(home, "worktrees", "child"),
      parentTaskId: task.id,
    })

    const result = await orch.moveTaskToProject(task.id, repoB)
    expect(result.repo).toBe(repoB)
    expect(result.moved).toEqual([String(child.id), String(task.id)])

    for (const [moved, before] of [
      [orch.getTask(task.id), task],
      [orch.getTask(child.id), child],
    ] as const) {
      expect(moved?.repo).toBe(repoB)
      expect(moved?.gitRepo).toBe(repoA)
      expect(moved?.worktreePath).toBe(before.worktreePath)
      expect(moved?.branch).toBe(before.branch)
    }

    await orch.deleteTask(task.id, { deleteBranch: true })
    expect(worktrees.remove).toHaveBeenCalledWith(
      task.worktreePath,
      expect.objectContaining({ repo: repoA, branch: "feat/x" }),
    )
  })

  it("moving back to the repo that cut the worktree drops the origin pointer", async () => {
    const task = await seedWorktreeTask(repoA)
    await orch.moveTaskToProject(task.id, repoB)
    await orch.moveTaskToProject(task.id, repoA)
    const back = orch.getTask(task.id)
    expect(back?.repo).toBe(repoA)
    expect(back?.gitRepo).toBeUndefined()
  })

  it("an Ungrouped scratch session joins the project and keeps its directory", async () => {
    const scratch = await orch.openDirectoryTask({ dir: join(home), scratch: true })
    await orch.moveTaskToProject(scratch.id, repoB)
    const moved = orch.getTask(scratch.id)
    expect(moved?.repo).toBe(repoB)
    expect(moved?.scratch).toBe(false)
    expect(moved?.worktreePath).toBe(scratch.worktreePath)
  })

  it.each([
    ["a project's main task", () => store.list().find((t) => t.repo === repoA)?.id, "TASK_NOT_MOVABLE"],
    ["a child task", async () => (await seedChild()).id, "CHILD_NOT_MOVABLE"],
    ["a task already in the target", async () => (await seedWorktreeTask(repoB)).id, "SAME_PROJECT"],
    [
      "a remote project's task",
      async () => (await seedWorktreeTask("ssh://box/srv/app")).id,
      "REMOTE_MOVE_UNSUPPORTED",
    ],
  ])("refuses %s before writing anything", async (_label, pick, code) => {
    const id = await pick()
    const before = JSON.stringify(store.list())
    await expect(orch.moveTaskToProject(id as string, repoB)).rejects.toThrow(new RegExp(`^${code}: `))
    expect(JSON.stringify(store.list())).toBe(before)
  })
})

async function seedChild(): Promise<Task> {
  const parent = await seedWorktreeTask(repoA)
  return seedWorktreeTask(repoA, { title: "kid", parentTaskId: parent.id })
}
