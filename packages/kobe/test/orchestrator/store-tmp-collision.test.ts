/**
 * Deterministic reconstruction of the CI flake behind issue #53:
 * `ENOENT: rename '.../tasks.json.tmp' -> '.../tasks.json'`.
 *
 * The flake needed two writers inside the critical section at once (the old
 * lockfile could be stolen through its empty-content window) PLUS a shared
 * staging file: writer B renamed `<path>.tmp` away, so writer A's rename hit
 * ENOENT. Stress runs only reproduced it under a full 8-worker suite; this
 * test builds the interleaving by construction instead — it pauses writer A
 * between its tmp write and its rename, force-breaks the lock the way the
 * old steal did, lets writer B complete a save, then resumes A.
 *
 * Own file because it module-mocks `node:fs/promises` to add the pause hook.
 */

import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const gate = vi.hoisted(() => ({
  /** When set, the next rename of a `.tmp` staging file trips this once… */
  trap: null as ((from: string) => void) | null,
  /** …and then suspends on this promise until the test releases it. */
  block: null as Promise<void> | null,
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...real,
    rename: async (from: string, to: string): Promise<void> => {
      if (gate.trap && String(from).endsWith(".tmp")) {
        const trip = gate.trap
        const block = gate.block
        gate.trap = null
        trip(String(from))
        if (block) await block
      }
      return real.rename(from, to)
    },
  }
})

import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { type TaskCreateInput, TaskIndexStore } from "../../src/orchestrator/index/store.ts"

describe("TaskIndexStore staging-file isolation (issue #53)", () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kobe-store-tmp-collision-"))
    await mkdir(join(home, ".rove"), { recursive: true })
  })

  afterEach(async () => {
    gate.trap = null
    gate.block = null
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

  it("a rival writer inside the critical section cannot break this save's rename", async () => {
    const storeA = new TaskIndexStore({ homeDir: home })
    const storeB = new TaskIndexStore({ homeDir: home })
    await storeA.load()
    await storeB.load()

    // Arm the trap: A's save pauses at the instant its staging file is fully
    // written, one step before the rename.
    let releaseA!: () => void
    gate.block = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const paused = new Promise<string>((resolve) => {
      gate.trap = resolve
    })

    const saveA = storeA.create(input("alpha"))
    await paused // A holds the lock; tmp written; rename pending

    // Force-break the lock exactly the way the old empty-window steal did:
    // the lockfile vanishes under A, so B's save enters the critical section
    // while A is still inside it.
    await unlink(join(home, ".rove", "tasks.json.lock"))
    await storeB.create(input("beta"))

    // Resume A. With the old SHARED `<path>.tmp`, B's completed save had
    // renamed the staging file away and this rename threw ENOENT — the CI
    // flake. With per-save staging names it completes. (B's task is
    // legitimately clobbered here: we broke the mutex on purpose, so
    // last-write-wins on the whole file is the expected data outcome — the
    // invariant under test is only that A's save cannot CRASH.)
    releaseA()
    await expect(saveA).resolves.toBeDefined()
    const disk = JSON.parse(await readFile(join(home, ".rove", "tasks.json"), "utf8")) as {
      tasks: Array<{ title: string }>
    }
    expect(disk.tasks.some((t) => t.title === "alpha")).toBe(true)
  })
})
