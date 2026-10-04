import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type TaskCreateInput, TaskIndexStore } from "../../src/orchestrator/index/store.ts"

/**
 * Multi-process consistency for the task index. Two kobe instances (TUI +
 * daemon + CLI) write the SAME `~/.rove/tasks.json`. Without the lock +
 * read-merge-write, a save serializes the writer's WHOLE in-memory snapshot,
 * so process B silently clobbers the task process A just created (lost
 * update). These tests pin the two guarantees: interleaved writes
 * keep BOTH tasks, and the lock is actually taken on the write path so two
 * processes can't physically race.
 */
describe("TaskIndexStore multi-process consistency", () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kobe-store-concurrency-"))
    await mkdir(join(home, ".rove"), { recursive: true })
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

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

  /** Read the on-disk manifest directly — the source of truth, not a cache. */
  async function readDisk(): Promise<{
    tasks: Array<{ id: string; title: string }>
    removed?: Array<{ id: string; at: string }>
  }> {
    const raw = await readFile(join(home, ".rove", "tasks.json"), "utf8")
    return JSON.parse(raw)
  }

  it("keeps both tasks when two processes create concurrently", async () => {
    // Two independent stores on the SAME home = two kobe processes.
    const procA = new TaskIndexStore({ homeDir: home })
    const procB = new TaskIndexStore({ homeDir: home })
    await procA.load()
    await procB.load()

    // Interleave the two creates. Without the lock + merge, whichever wrote
    // last would persist only its own task (it based the write on its empty
    // load snapshot). With the merge the loser re-reads, finds the peer's task,
    // and merges its own on top.
    const [taskA, taskB] = await Promise.all([procA.create(input("alpha")), procB.create(input("beta"))])

    const disk = await readDisk()
    const ids = disk.tasks.map((t) => t.id).sort()
    expect(ids).toEqual([taskA.id, taskB.id].sort())
    expect(disk.tasks.map((t) => t.title).sort()).toEqual(["alpha", "beta"])
  })

  it("does not resurrect a task a peer process deleted", async () => {
    // A creates a task and persists it; B loads and sees it.
    const procA = new TaskIndexStore({ homeDir: home })
    await procA.load()
    const task = await procA.create(input("doomed"))

    const procB = new TaskIndexStore({ homeDir: home })
    await procB.load()
    expect(procB.get(task.id)).toBeDefined()

    // A removes it (gone from disk). B then writes an UNRELATED create.
    // B's stale cache still holds the doomed task, but the merge must take the
    // peer's deletion as truth and not write it back.
    await procA.remove(task.id)
    const survivor = await procB.create(input("survivor"))

    const disk = await readDisk()
    const ids = disk.tasks.map((t) => t.id)
    expect(ids).toContain(survivor.id)
    expect(ids).not.toContain(task.id)
  })

  it("a peer's deletion beats this instance's pending edit (persistent tombstone)", async () => {
    const procA = new TaskIndexStore({ homeDir: home })
    await procA.load()
    const task = await procA.create(input("doomed"))

    const procB = new TaskIndexStore({ homeDir: home })
    await procB.load()

    // A deletes; B then touches the SAME task without flushing (touchRecency
    // marks dirty but defers the save). At B's next save the task is dirty in
    // B's memory while gone from disk — the resurrection recipe: a merge
    // whose dirty branch writes it back unconditionally.
    // A's on-disk tombstone must beat B's pending edit.
    await procA.remove(task.id)
    procB.touchRecency(task.id)
    const survivor = await procB.create(input("survivor"))

    const disk = await readDisk()
    const ids = disk.tasks.map((t) => t.id)
    expect(ids).toContain(survivor.id)
    expect(ids).not.toContain(task.id)
    // The tombstone itself is preserved by B's merge, so a THIRD stale writer
    // can't resurrect the task either.
    expect(disk.removed?.some((r) => r.id === task.id)).toBe(true)
  })

  it("does not resurrect a legacy task after a peer creates the canonical index", async () => {
    const legacyDir = join(home, ".kobe")
    await mkdir(legacyDir, { recursive: true })
    const first = {
      ...input("first"),
      id: "01J000000000000000000FIRST",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    const second = {
      ...input("second"),
      id: "01J00000000000000000SECOND",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    await writeFile(join(legacyDir, "tasks.json"), JSON.stringify({ version: 3, tasks: [first, second] }), "utf8")

    const procA = new TaskIndexStore({ homeDir: home })
    const procB = new TaskIndexStore({ homeDir: home })
    await procA.load()
    await procB.load()

    await procA.remove(first.id)
    await procB.update(second.id, { title: "updated by B" })

    const disk = await readDisk()
    expect(disk.tasks).toHaveLength(1)
    expect(disk.tasks[0]).toMatchObject({ id: second.id, title: "updated by B" })
  })

  it("does not resurrect a task this process deleted from a stale disk copy", async () => {
    // Seed disk with one task, load it, delete it. The merge reads the still-
    // present on-disk row but must honor the in-flight removal.
    await writeFile(
      join(home, ".rove", "tasks.json"),
      JSON.stringify({
        version: 3,
        tasks: [
          {
            ...input("gone"),
            id: "01J0000000000000000000GONE",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    )
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()
    await store.remove("01J0000000000000000000GONE")

    const disk = await readDisk()
    expect(disk.tasks).toHaveLength(0)
  })

  it("evicts a task a peer deleted from its own cache, and tells listeners", async () => {
    const procA = new TaskIndexStore({ homeDir: home })
    await procA.load()
    const doomed = await procA.create(input("doomed"))

    const procB = new TaskIndexStore({ homeDir: home })
    await procB.load()
    expect(procB.get(doomed.id)).toBeDefined()

    let sawRemoval = false
    procB.subscribe((snapshot) => {
      sawRemoval = !snapshot.some((t) => t.id === doomed.id)
    })
    sawRemoval = false // ignore subscribe's eager fire

    await procA.remove(doomed.id)
    // B's own read-merge-write correctly omits the task from the BYTES, but
    // used to fold the merge into its cache additively only — so B kept
    // listing a row that no longer existed, forever, and kept rewriting a
    // file without it. The eviction has to be tombstone-scoped: an entry the
    // merge simply never saw (a create racing the write) must survive.
    await procB.create(input("unrelated"))

    expect(procB.get(doomed.id)).toBeUndefined()
    expect(procB.list().map((t) => t.title)).toEqual(["unrelated"])
    expect(sawRemoval).toBe(true)
  })

  it("reports whether remove() had anything to remove", async () => {
    const procA = new TaskIndexStore({ homeDir: home })
    await procA.load()
    // B's cache predates the task, exactly like a peer process that has not
    // reloaded. `remove` used to return void either way, so "deleted" and
    // "there was nothing here" were the same answer.
    const procB = new TaskIndexStore({ homeDir: home })
    await procB.load()
    const task = await procA.create(input("unseen-by-b"))

    expect(await procB.remove(task.id)).toBe(false)
    expect(await procA.remove(task.id)).toBe(true)
  })

  it("blocks the write path on the index lock", async () => {
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()

    // Externally hold the index lock with a LIVE holder (our own pid). A save
    // must spin on `acquire` and not complete while the lock is held — this is
    // what proves the lock guards the write path rather than being dead code.
    const lockPath = join(home, ".rove", "tasks.json.lock")
    await writeFile(lockPath, String(process.pid), "utf8")

    let settled = false
    const createP = store.create(input("blocked")).then((task) => {
      settled = true
      return task
    })

    // Spin window well under the retry deadline; the create must still be pending.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(settled).toBe(false)

    // Release the lock; the queued write now proceeds and persists.
    await rm(lockPath)
    const task = await createP
    expect(settled).toBe(true)
    expect(store.get(task.id)).toBeDefined()
    const disk = await readDisk()
    expect(disk.tasks.map((t) => t.id)).toContain(task.id)
  })
})
