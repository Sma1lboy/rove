import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { DirtyWorktreeError } from "../../src/orchestrator/errors.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task, TaskId } from "../../src/types/task.ts"

const DURABLE_WRITE_TIMEOUT_MS = 30_000

let home: string
let store: TaskIndexStore
let orch: Orchestrator
let worktrees: {
  dirtyPaths: ReturnType<typeof vi.fn>
  ignoredWork: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  renameBranch: ReturnType<typeof vi.fn>
  pathExists: ReturnType<typeof vi.fn>
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "rove-child-deletion-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  worktrees = {
    dirtyPaths: vi.fn(async () => []),
    ignoredWork: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
    renameBranch: vi.fn(async () => {}),
    pathExists: vi.fn(async () => true),
  }
  orch = new Orchestrator({ store, worktrees: worktrees as unknown as GitWorktreeManager })
})

afterEach(async () => {
  orch.dispose()
  await rm(home, { recursive: true, force: true })
})

/** A managed worktree task row, optionally a child of / sharer of another. */
async function row(
  title: string,
  extra: { parent?: Task; shares?: Task; path?: string; kind?: Task["kind"] } = {},
): Promise<Task> {
  const owner = extra.shares
  return store.create({
    repo: "/repo",
    title,
    branch: owner ? owner.branch : `b/${title}`,
    worktreePath: owner ? owner.worktreePath : (extra.path ?? `/wt/${title}`),
    status: "backlog",
    kind: extra.kind ?? "task",
    vendor: "claude",
    ...(extra.parent ? { parentTaskId: extra.parent.id } : {}),
    ...(owner ? { sharesWorkspaceOf: owner.id } : {}),
  })
}

const ids = () => store.list().map((t) => t.title)

describe("deleting tasks that share a directory", { timeout: DURABLE_WRITE_TIMEOUT_MS }, () => {
  it("never removes the directory when a shared child is deleted", async () => {
    const owner = await row("owner")
    const child = await row("child", { parent: owner, shares: owner })

    await orch.deleteTask(child.id)

    expect(worktrees.remove).not.toHaveBeenCalled()
    expect(ids()).toEqual(["owner"])
  })

  it("keeps the directory when the owner leaves and hands it to the first remaining sharer", async () => {
    const owner = await row("owner")
    const first = await row("first", { parent: owner, shares: owner })
    const second = await row("second", { parent: owner, shares: owner })

    await orch.deleteTask(owner.id)

    expect(worktrees.remove).not.toHaveBeenCalled()
    expect(store.get(first.id)?.sharesWorkspaceOf).toBeUndefined()
    expect(store.get(second.id)?.sharesWorkspaceOf).toBe(first.id)
  })

  it("removes the directory with the last row standing, not with whichever is deleted first", async () => {
    const owner = await row("owner")
    const child = await row("child", { parent: owner, shares: owner })

    await orch.deleteTask(owner.id)
    expect(worktrees.remove).not.toHaveBeenCalled()
    await orch.deleteTask(child.id)

    expect(worktrees.remove).toHaveBeenCalledTimes(1)
    expect(worktrees.remove).toHaveBeenCalledWith("/wt/owner", expect.anything())
    expect(ids()).toEqual([])
  })

  it("does not dirty-gate an owner whose directory a child still uses", async () => {
    const owner = await row("owner")
    await row("child", { parent: owner, shares: owner })
    worktrees.dirtyPaths.mockResolvedValue(["wip.ts"])

    await expect(orch.deleteTask(owner.id)).resolves.toBeUndefined()
  })
})

describe("deleting a task that has children", { timeout: DURABLE_WRITE_TIMEOUT_MS }, () => {
  it("promotes children to the deleted task's own parent by default", async () => {
    const grand = await row("grand")
    const mid = await row("mid", { parent: grand })
    const leaf = await row("leaf", { parent: mid })

    await orch.deleteTask(mid.id)

    expect(store.get(leaf.id)?.parentTaskId).toBe(grand.id)
    expect(store.get(grand.id)).toBeDefined()
  })

  it("promotes children of a top-level task to top level", async () => {
    const top = await row("top")
    const leaf = await row("leaf", { parent: top })

    await orch.deleteTask(top.id)

    expect(store.get(leaf.id)?.parentTaskId).toBeUndefined()
  })

  it("deletes the whole subtree with cascade", async () => {
    const top = await row("top")
    const mid = await row("mid", { parent: top })
    await row("leaf", { parent: mid })
    await row("unrelated")

    await orch.deleteTask(top.id, { cascade: true })

    expect(ids()).toEqual(["unrelated"])
    expect(worktrees.remove).toHaveBeenCalledTimes(3)
  })

  it("queues nothing when any worktree in the subtree fails the dirty gate", async () => {
    const top = await row("top")
    const child = await row("child", { parent: top })
    worktrees.dirtyPaths.mockImplementation(async (path: string) => (path === "/wt/child" ? ["wip.ts"] : []))

    await expect(orch.deleteTask(top.id, { cascade: true })).rejects.toThrow(DirtyWorktreeError)

    expect(store.get(top.id)?.deletion).toBeUndefined()
    expect(store.get(child.id)?.deletion).toBeUndefined()
    expect(worktrees.remove).not.toHaveBeenCalled()
  })

  it("never removes a dir-kind child's directory on a cascade", async () => {
    const top = await row("top", { kind: "dir", path: "/users/own-dir" })
    const sharer = await row("sharer", { parent: top, shares: top, kind: "dir" })

    await orch.deleteTask(top.id, { cascade: true })

    expect(worktrees.remove).not.toHaveBeenCalled()
    expect(store.get(sharer.id as TaskId)).toBeUndefined()
  })
})

describe("deleting a task whose PTY hosts a child's conversation", { timeout: DURABLE_WRITE_TIMEOUT_MS }, () => {
  it("promotes the aliased child and keeps its alias; a cascade takes it along", async () => {
    const parent = await row("parent")
    const migrated = await row("migrated", { parent, shares: parent })
    await store.update(migrated.id, { ptyAlias: { taskId: parent.id, tabId: "tab-2" } })

    await orch.deleteTask(parent.id)
    expect(ids()).toEqual(["migrated"])
    expect(store.get(migrated.id)?.ptyAlias).toEqual({ taskId: parent.id, tabId: "tab-2" })

    const other = await row("other")
    const twin = await row("twin", { parent: other, shares: other })
    await store.update(twin.id, { ptyAlias: { taskId: other.id, tabId: "tab-2" } })
    await orch.deleteTask(other.id, { cascade: true })
    expect(ids()).toEqual(["migrated"])
  })
})

describe("deleting an owner whose shared child survives", { timeout: DURABLE_WRITE_TIMEOUT_MS }, () => {
  it("promotes the shared child to a top-level task on the kept directory", async () => {
    const owner = await row("owner")
    const shared = await row("shared", { parent: owner, shares: owner })
    const forked = await row("forked", { parent: owner, path: "/wt/forked" })

    await orch.deleteTask(owner.id)

    expect(store.get(shared.id)).toMatchObject({ worktreePath: "/wt/owner", branch: "b/owner" })
    expect(store.get(shared.id)?.parentTaskId).toBeUndefined()
    expect(store.get(shared.id)?.sharesWorkspaceOf).toBeUndefined()
    // Nothing of the owner's deletion leaks onto the survivor, or the sidebar would hide it.
    expect(store.get(shared.id)?.deletion).toBeUndefined()
    expect(store.get(forked.id)?.parentTaskId).toBeUndefined()
    expect(worktrees.remove).not.toHaveBeenCalled()
  })

  it("runs the dirty gate when the owner and a cascaded branch of its sharers are deleted at the same moment", async () => {
    const owner = await row("owner")
    const mid = await row("mid", { parent: owner, shares: owner })
    await row("leaf", { parent: mid, shares: owner })
    worktrees.dirtyPaths.mockResolvedValue(["wip.ts"])

    const results = await Promise.allSettled([
      orch.prepareTaskDeletion(mid.id, { cascade: true }),
      orch.prepareTaskDeletion(owner.id),
    ])

    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
    expect(worktrees.remove).not.toHaveBeenCalled()
  })

  it("carries deleteBranch from the first row out to the last row standing", async () => {
    const owner = await row("owner")
    const child = await row("child", { parent: owner, shares: owner })

    await orch.deleteTask(owner.id, { deleteBranch: true })
    expect(worktrees.remove).not.toHaveBeenCalled()
    expect(store.get(child.id)?.deleteBranchPending).toBe(true)

    await orch.deleteTask(child.id)
    expect(worktrees.remove).toHaveBeenCalledWith("/wt/owner", expect.objectContaining({ deleteBranch: true }))
  })

  it("hands deleteBranch to a sibling that is leaving at the same time", async () => {
    const owner = await row("owner")
    const child = await row("child", { parent: owner, shares: owner })
    await orch.prepareTaskDeletion(owner.id, { deleteBranch: true })
    await orch.prepareTaskDeletion(child.id)

    await orch.beginTaskDeletion(owner.id)
    await orch.finishTaskDeletion(owner.id)
    await orch.beginTaskDeletion(child.id)
    await orch.finishTaskDeletion(child.id)

    expect(worktrees.remove).toHaveBeenCalledWith("/wt/owner", expect.objectContaining({ deleteBranch: true }))
  })
})

describe("the branch of rows that share a directory", { timeout: DURABLE_WRITE_TIMEOUT_MS }, () => {
  it("follows a rename made from the owner or from a sharer, on every row of the directory", async () => {
    const owner = await row("owner")
    const first = await row("first", { parent: owner, shares: owner })
    const second = await row("second", { parent: first, shares: owner })
    const other = await row("other")

    await orch.setBranch(first.id, "renamed")

    for (const id of [owner.id, first.id, second.id]) expect(store.get(id)?.branch).toBe("renamed")
    expect(store.get(other.id)?.branch).toBe("b/other")
    expect(worktrees.renameBranch).toHaveBeenCalledTimes(1)
  })

  it("is re-read from the owner when a sharer is next entered", async () => {
    const owner = await row("owner")
    const sharer = await row("sharer", { parent: owner, shares: owner })
    await store.update(owner.id, { branch: "moved-on" })

    await orch.ensureWorktree(sharer.id)

    expect(store.get(sharer.id)?.branch).toBe("moved-on")
  })
})
