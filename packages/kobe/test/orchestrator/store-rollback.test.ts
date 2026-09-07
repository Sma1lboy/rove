import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type TaskCreateInput, TaskIndexStore } from "../../src/orchestrator/index/store.ts"

/**
 * What the store does when the write does NOT land.
 *
 * The mutators apply to the cache first and persist second, so a failed save
 * used to leave the change sitting in the cache AND in `dirtyIds`: the caller
 * got an error, `get`/`list` reported the new value anyway, and the next
 * UNRELATED successful save flushed the "failed" write to disk minutes later.
 * For `create` that means a task materialising after the caller gave up —
 * with no worktree, no branch and no engine.
 */
describe("TaskIndexStore rollback on a failed save", () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kobe-store-rollback-"))
    await mkdir(join(home, ".rove"), { recursive: true })
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const lockPath = (): string => join(home, ".rove", "tasks.json.lock")

  /**
   * Break the save deterministically by putting a DIRECTORY where the
   * lockfile goes: `acquire`'s `link` fails EEXIST, the holder read then
   * fails EISDIR, and that is not a contention error so it propagates
   * immediately — no 5s retry deadline, no timing, no chmod.
   */
  const breakSaves = async (): Promise<void> => {
    await mkdir(lockPath(), { recursive: true })
  }
  const healSaves = (): Promise<void> => rm(lockPath(), { recursive: true, force: true })

  function input(title: string): TaskCreateInput {
    return {
      title,
      repo: "/repo",
      branch: `kobe/${title}`,
      worktreePath: `/repo/.kobe/worktrees/${title}`,
      kind: "task",
      status: "backlog",
    }
  }

  async function diskTitles(): Promise<string[]> {
    const raw = await readFile(join(home, ".rove", "tasks.json"), "utf8")
    return (JSON.parse(raw) as { tasks: Array<{ title: string }> }).tasks.map((t) => t.title)
  }

  it("drops a create whose save failed, and no later save resurrects it", async () => {
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()

    await breakSaves()
    await expect(store.create(input("ghost"))).rejects.toThrow()
    // The caller was told no; the cache must agree.
    expect(store.list()).toHaveLength(0)

    // The specific bug: the id stayed dirty, so an UNRELATED mutation's save
    // carried someone else's failed write to disk.
    await healSaves()
    await store.create(input("unrelated"))
    expect(await diskTitles()).toEqual(["unrelated"])
  })

  it("restores the previous value of an update whose save failed", async () => {
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()
    const task = await store.create(input("orig"))

    await breakSaves()
    await expect(store.update(task.id, { title: "renamed" })).rejects.toThrow()
    expect(store.get(task.id)?.title).toBe("orig")
    expect(store.get(task.id)?.updatedAt).toBe(task.updatedAt)

    await healSaves()
    await store.create(input("unrelated"))
    expect((await diskTitles()).sort()).toEqual(["orig", "unrelated"])
  })

  it("restores the previous order of a move whose save failed", async () => {
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()
    const a = await store.create(input("a"))
    await store.create(input("b"))

    await breakSaves()
    await expect(store.move(a.id, 1)).rejects.toThrow()
    expect(store.list().map((t) => t.title)).toEqual(["a", "b"])
    expect(store.list()[0]?.updatedAt).toBe(a.updatedAt)

    await healSaves()
    await store.create(input("c"))
    expect(await diskTitles()).toEqual(["a", "b", "c"])
  })

  it("keeps a task whose delete failed, and no later save completes the deletion", async () => {
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()
    const task = await store.create(input("doomed"))

    await breakSaves()
    await expect(store.remove(task.id)).rejects.toThrow()
    // The caller was told the delete failed; the sidebar must agree — the row
    // vanishing next to a "delete failed" toast is the reported symptom.
    expect(store.list().map((t) => t.title)).toEqual(["doomed"])

    // The durable half: the tombstone must be gone too, or the next unrelated
    // save carries the rejected deletion to disk minutes later.
    await healSaves()
    await store.create(input("unrelated"))
    expect((await diskTitles()).sort()).toEqual(["doomed", "unrelated"])
  })

  it("never lets two failed updates on one id reach disk, whichever rolls back first", async () => {
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()
    const task = await store.create(input("orig"))

    await breakSaves()
    const first = store.update(task.id, { title: "first" })
    // Queued behind it, on the SAME id: this one now owns the cache entry, so
    // the older mutation's undo must not clobber it (it reverts by object
    // identity and reports that it did nothing).
    const second = store.update(task.id, { title: "second" })
    await expect(first).rejects.toThrow()
    await expect(second).rejects.toThrow()

    // Each undo restores what IT displaced, so the cache lands on the
    // intermediate value rather than all the way back on "orig". What has to
    // hold regardless of unwind order is the durable half: the id is no
    // longer dirty, so the merge takes the disk copy and no rejected title
    // ever reaches the file.
    await healSaves()
    await store.create(input("unrelated"))
    expect((await diskTitles()).sort()).toEqual(["orig", "unrelated"])
  })
})
