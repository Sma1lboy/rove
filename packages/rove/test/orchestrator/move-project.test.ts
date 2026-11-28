/**
 * Moving a task to another project (`update --project`) regroups the rows only: the checkout and branch stay
 * put, and anything git-side (delete, land) still runs in the repo that cut the worktree.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizeMainRepo } from "@sma1lboy/rove-core/orchestrator/core-helpers.ts"
import { Orchestrator } from "@sma1lboy/rove-core/orchestrator/core.ts"
import { TaskIndexStore } from "@sma1lboy/rove-core/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "@sma1lboy/rove-core/orchestrator/worktree/manager.ts"
import { addSavedRepo } from "@sma1lboy/rove-core/state/repos.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let home: string
let repoA: string
let repoB: string
let store: TaskIndexStore
let orch: Orchestrator
let originalHome: string | undefined
const worktrees = {
  dirtyPaths: vi.fn(async () => [] as string[]),
  remove: vi.fn(async () => {}),
  pathExists: vi.fn(async () => true),
  ignoredWork: vi.fn(async () => [] as string[]),
}

/** A saved project; the fixture dirs are not git repos, so the eligibility gate is skipped. */
function seedProject(repo: string): string {
  const { repo: normalized } = normalizeMainRepo(repo)
  addSavedRepo(normalized, { skipGate: true })
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
  // savedRepos lives in state.json: keep it off the developer's real one.
  originalHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = home
  repoA = await mkdtemp(join(tmpdir(), "rove-move-a-"))
  repoB = await mkdtemp(join(tmpdir(), "rove-move-b-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  orch = new Orchestrator({ store, worktrees: worktrees as unknown as GitWorktreeManager })
  repoA = seedProject(repoA)
  repoB = seedProject(repoB)
})

afterEach(async () => {
  orch.dispose()
  // biome-ignore lint/performance/noDelete: assigning undefined would leave the string "undefined".
  if (originalHome === undefined) delete process.env.ROVE_HOME_DIR
  else process.env.ROVE_HOME_DIR = originalHome
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

    expect(orch.getTask(task.id)).toMatchObject({
      repo: repoB,
      gitRepo: repoA,
      worktreePath: task.worktreePath,
      branch: task.branch,
    })
    expect(orch.getTask(child.id)).toMatchObject({
      repo: repoB,
      gitRepo: repoA,
      worktreePath: child.worktreePath,
      branch: child.branch,
    })

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
    [
      "a routine session",
      async () => (await seedWorktreeTask(repoA, { routine: { automationId: "a1" } })).id,
      "TASK_NOT_MOVABLE",
    ],
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
