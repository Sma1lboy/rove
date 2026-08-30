import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { DirtyWorktreeError, TaskDeletingError, WorktreeRemoveFailedError } from "../../src/orchestrator/errors.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let home: string
let store: TaskIndexStore
let orch: Orchestrator
let worktrees: {
  isDirty: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "kobe-task-deletion-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  worktrees = {
    isDirty: vi.fn(async () => false),
    remove: vi.fn(async () => {}),
  }
  orch = new Orchestrator({ store, worktrees: worktrees as unknown as GitWorktreeManager })
})

afterEach(async () => {
  orch.dispose()
  await rm(home, { recursive: true, force: true })
})

async function makeTask(worktreePath = "/wt/task") {
  const task = await orch.createTask({ repo: "/repo", title: "task", vendor: "claude" })
  await store.update(task.id, { worktreePath })
  return orch.getTask(task.id)!
}

describe("durable background task deletion", () => {
  it("persists queued/running before physical cleanup and removes the task only on success", async () => {
    const task = await makeTask()

    await expect(orch.prepareTaskDeletion(task.id)).resolves.toBe(true)
    expect(orch.getTask(task.id)?.deletion).toMatchObject({ phase: "queued", force: false })
    expect(worktrees.remove).not.toHaveBeenCalled()

    await expect(orch.beginTaskDeletion(task.id)).resolves.toBe(true)
    expect(orch.getTask(task.id)?.deletion?.phase).toBe("running")

    await orch.finishTaskDeletion(task.id)
    // Design guarantee (issue #29): delete keeps the branch by default —
    // git is the durable record, the task row is not.
    expect(worktrees.remove).toHaveBeenCalledWith(
      "/wt/task",
      expect.objectContaining({ force: false, deleteBranch: false }),
    )
    expect(orch.getTask(task.id)).toBeUndefined()
  })

  it("deletes the branch only on explicit deleteBranch opt-in", async () => {
    const task = await makeTask("/wt/opt-in")

    await orch.prepareTaskDeletion(task.id, { deleteBranch: true })
    await orch.beginTaskDeletion(task.id)
    await orch.finishTaskDeletion(task.id)
    expect(worktrees.remove).toHaveBeenCalledWith(
      "/wt/opt-in",
      expect.objectContaining({ force: false, deleteBranch: true }),
    )
  })

  it("a forced delete reports the salvage ref so the loss is recoverable", async () => {
    // The queued deletion's `force` was frozen at prepare() time and the
    // removal runs on a later tick (possibly a later daemon process), so the
    // worktree can go dirty in between. The gate is deliberately NOT
    // re-evaluated — instead the manager snapshots, and that ref must reach
    // the orchestrator's sink or the user has no way to find it.
    const salvages: { taskId: string; ref: string }[] = []
    const localStore = new TaskIndexStore({ homeDir: home })
    await localStore.load()
    const localOrch = new Orchestrator({
      store: localStore,
      worktrees: worktrees as unknown as GitWorktreeManager,
      onSalvage: (taskId, salvage) => salvages.push({ taskId: String(taskId), ref: salvage.ref }),
    })
    worktrees.remove.mockImplementationOnce(
      async (_path: string, opts: { onSalvage?: (r: { ref: string; commit: string } | null) => void }) => {
        opts.onSalvage?.({ ref: "refs/rove/salvage/feature-20260830T101500Z", commit: "abc1234" })
      },
    )

    const task = await localOrch.createTask({ repo: "/repo", title: "forced", vendor: "claude" })
    await localStore.update(task.id, { worktreePath: "/wt/salvaged" })
    await localOrch.prepareTaskDeletion(task.id, { force: true })
    await localOrch.beginTaskDeletion(task.id)
    await localOrch.finishTaskDeletion(task.id)
    localOrch.dispose()

    expect(salvages).toEqual([{ taskId: String(task.id), ref: "refs/rove/salvage/feature-20260830T101500Z" }])
  })

  it("an unforced delete with nothing to salvage reports nothing", async () => {
    const salvages: string[] = []
    const localStore = new TaskIndexStore({ homeDir: home })
    await localStore.load()
    const localOrch = new Orchestrator({
      store: localStore,
      worktrees: worktrees as unknown as GitWorktreeManager,
      onSalvage: (_taskId, salvage) => salvages.push(salvage.ref),
    })
    worktrees.remove.mockImplementationOnce(
      async (_path: string, opts: { onSalvage?: (r: null) => void }) => void opts.onSalvage?.(null),
    )

    const task = await localOrch.createTask({ repo: "/repo", title: "clean", vendor: "claude" })
    await localStore.update(task.id, { worktreePath: "/wt/clean" })
    await localOrch.deleteTask(task.id)
    localOrch.dispose()

    expect(salvages).toEqual([])
  })

  it("deleting a dir task never touches its directory, forced or not", async () => {
    // The scratch-shell teardown used to pass `force: true` on the reasoning
    // that a scratch row owns no worktree. That is true only while the row is
    // `kind: "dir"` — and the flag was unconditional, so it stood ready to
    // authorise a real destructive removal if the row's kind ever changed.
    // Both gates already special-case `dir`, which is what makes the flag
    // redundant; this pins that, so dropping it stays safe.
    for (const force of [false, true]) {
      const task = await orch.createTask({ repo: "/repo", title: "dir", vendor: "claude" })
      await store.update(task.id, { worktreePath: "/home/me/project", kind: "dir" })
      worktrees.isDirty.mockResolvedValueOnce(true)

      await expect(orch.prepareTaskDeletion(task.id, { force })).resolves.toBe(true)
      await orch.beginTaskDeletion(task.id)
      await orch.finishTaskDeletion(task.id)

      expect(orch.getTask(task.id)).toBeUndefined()
    }
    // A dirty `dir` task neither refuses (the gate is skipped) nor removes
    // anything — with force, and equally without it.
    expect(worktrees.remove).not.toHaveBeenCalled()
  })

  it("force does not escalate into branch deletion", async () => {
    const task = await makeTask("/wt/forced")
    worktrees.isDirty.mockResolvedValue(true)

    await orch.prepareTaskDeletion(task.id, { force: true })
    await orch.beginTaskDeletion(task.id)
    await orch.finishTaskDeletion(task.id)
    expect(worktrees.remove).toHaveBeenCalledWith(
      "/wt/forced",
      expect.objectContaining({ force: true, deleteBranch: false }),
    )
  })

  it("keeps a visible error after cleanup failure and supports an explicit retry", async () => {
    const task = await makeTask()
    worktrees.remove.mockRejectedValueOnce(new Error("locked"))

    await orch.prepareTaskDeletion(task.id, { force: true })
    await orch.beginTaskDeletion(task.id)
    await expect(orch.finishTaskDeletion(task.id)).rejects.toThrow(WorktreeRemoveFailedError)
    expect(orch.getTask(task.id)?.deletion).toMatchObject({
      phase: "error",
      force: true,
      error: expect.stringContaining("locked"),
    })

    await orch.prepareTaskDeletion(task.id, { force: true })
    expect(orch.getTask(task.id)?.deletion).toMatchObject({ phase: "queued", force: true })
    await orch.beginTaskDeletion(task.id)
    await orch.finishTaskDeletion(task.id)
    expect(orch.getTask(task.id)).toBeUndefined()
  })

  it("runs the dirty-worktree guard before accepting and force bypasses it", async () => {
    const task = await makeTask("/wt/dirty")
    worktrees.isDirty.mockResolvedValue(true)

    await expect(orch.prepareTaskDeletion(task.id)).rejects.toThrow(DirtyWorktreeError)
    expect(orch.getTask(task.id)?.deletion).toBeUndefined()
    // The refusal is a true preflight: nothing destructive has run — no
    // worktree removal was even attempted, and (since the daemon runner only
    // tears down sessions AFTER a deletion is queued) no session teardown
    // could have happened either.
    expect(worktrees.remove).not.toHaveBeenCalled()
    await expect(orch.prepareTaskDeletion(task.id, { force: true })).resolves.toBe(true)
    expect(worktrees.isDirty).toHaveBeenCalledTimes(1)
    expect(orch.getTask(task.id)?.deletion?.force).toBe(true)
  })

  it("orphaned worktree (dirty probe fails) still queues and completes cleanup", async () => {
    // An orphan — the dir vanished out-of-band — makes `isDirty` throw
    // (ENOENT / "not a git repository"). That must NOT block deletion: the
    // probe failure is swallowed, the deletion queues, and `remove()`
    // resolves the missing path itself (best-effort metadata prune).
    const task = await makeTask("/wt/gone")
    worktrees.isDirty.mockRejectedValue(new Error("ENOENT: no such file or directory"))

    await expect(orch.prepareTaskDeletion(task.id)).resolves.toBe(true)
    await orch.beginTaskDeletion(task.id)
    await orch.finishTaskDeletion(task.id)
    expect(worktrees.remove).toHaveBeenCalledWith(
      "/wt/gone",
      expect.objectContaining({ force: false, deleteBranch: false }),
    )
    expect(orch.getTask(task.id)).toBeUndefined()
  })

  it("rejects focus and worktree materialization once deletion is accepted", async () => {
    const task = await makeTask("")
    await orch.prepareTaskDeletion(task.id)

    await expect(orch.setActiveTask(task.id)).rejects.toThrow(TaskDeletingError)
    await expect(orch.ensureWorktree(task.id)).rejects.toThrow(TaskDeletingError)
  })
})

describe("dir tasks on the daemon's prepare→begin→finish path", () => {
  it("NEVER removes the user's own directory, and never probes it for dirt", async () => {
    // This is the path `rove api delete` takes. `finish()` has its OWN
    // `kind !== "dir"` guard, separate from the one `deleteNow()` reaches
    // through `prepare()` — dir-task.test.ts covers only the latter, so
    // deleting the guard at task-deletion.ts:78 goes unnoticed there.
    //
    // What the guard protects: a dir task's `worktreePath` IS the user's own
    // directory (`rove .` — their project root, possibly their $HOME). A
    // `git worktree remove --force` on it deletes their files.
    const dir = await mkdtemp(join(tmpdir(), "kobe-user-dir-"))
    try {
      const task = await orch.openDirectoryTask({ dir })
      // Dirty on purpose: a dir task must skip the gate rather than pass it.
      worktrees.isDirty.mockResolvedValue(true)

      await expect(orch.prepareTaskDeletion(task.id)).resolves.toBe(true)
      await expect(orch.beginTaskDeletion(task.id)).resolves.toBe(true)
      await orch.finishTaskDeletion(task.id)

      // Delete the `&& task.kind !== "dir"` in finish() and this goes red.
      expect(worktrees.remove).not.toHaveBeenCalled()
      // Delete it in prepare() and this goes red (a dirty dir would also
      // have thrown DirtyWorktreeError above, blocking a legitimate delete).
      expect(worktrees.isDirty).not.toHaveBeenCalled()
      // The row is gone — dropping the index entry is the whole job.
      expect(orch.getTask(task.id)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("force + deleteBranch on a dir task still removes nothing on disk", async () => {
    // The escalating flags (`rove api delete --force --delete-branch`) must
    // not talk the coordinator past the kind check.
    const dir = await mkdtemp(join(tmpdir(), "kobe-user-dir-"))
    try {
      const task = await orch.openDirectoryTask({ dir })
      await orch.prepareTaskDeletion(task.id, { force: true, deleteBranch: true })
      await orch.beginTaskDeletion(task.id)
      await orch.finishTaskDeletion(task.id)

      expect(worktrees.remove).not.toHaveBeenCalled()
      expect(orch.getTask(task.id)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
