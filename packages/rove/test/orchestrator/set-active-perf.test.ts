/**
 * Op budget for the focus-switch hot path — OPERATION COUNTS, never wall-clock
 * (docs/HARNESS.md §Performance contracts).
 *
 * `setActiveTask` is the most frequent user action in this multi-session TUI
 * (every task/focus switch). It records the last-focused id on its own and
 * touches nothing in the task index: no fsync'd read-merge-write, no
 * `updatedAt` bump (the `recent` sort must not move a row under a click), no
 * task-snapshot broadcast.
 *
 * The disk-write count is observed at the SAME seam production writes: the
 * atomic `rename(tmpPath, tasks.json)` that completes a `doSave`. A regression
 * that puts a persist back on the focus path shows up as extra renames to the
 * manifest, which the UI would never reveal.
 */

import type * as FsPromises from "node:fs/promises"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

/**
 * The store completes a doSave with `rename(tmpPath, tasks.json)`. Wrap the
 * real `node:fs/promises` so `rename` records every call while behaving
 * normally — the SAME seam the store writes through. (A plain `vi.spyOn` can't
 * redefine the ESM named binding the store already captured.)
 */
const renameCalls = vi.hoisted(() => ({ dests: [] as string[] }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      renameCalls.dests.push(String(to))
      return actual.rename(from, to)
    },
  }
})

describe("setActiveTask focus-switch op budget", () => {
  let home: string
  let orch: Orchestrator
  let store: TaskIndexStore

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "rove-set-active-perf-"))
    vi.stubEnv("ROVE_HOME_DIR", home)
    store = new TaskIndexStore({ homeDir: home })
    await store.load()
    orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
    renameCalls.dests.length = 0
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    orch.dispose()
    await rm(home, { recursive: true, force: true })
  })

  /** Renames whose destination is the store's manifest = a completed doSave. */
  function diskWritesToManifest(): number {
    return renameCalls.dests.filter((dest) => dest === store.filePath).length
  }

  it("does no disk rewrite, no snapshot broadcast and no updatedAt change across 10 focus switches", async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const t = await orch.createTask({ repo: "/repo", title: `t${i}`, branch: `t${i}`, vendor: "claude" })
      ids.push(String(t.id))
    }
    const stamps = () => orch.listTasks().map((task) => task.updatedAt)
    const before = stamps()
    let snapshotPublishes = 0
    const unsub = orch.subscribeTasks(() => {
      snapshotPublishes++
    })

    // Isolate the focus-switch path from the creates + the subscribe echo.
    renameCalls.dests.length = 0
    snapshotPublishes = 0

    for (let i = 0; i < 10; i++) {
      await orch.setActiveTask(ids[i % 5] ?? null)
    }

    expect(diskWritesToManifest()).toBe(0)
    expect(snapshotPublishes).toBe(0)
    expect(stamps()).toEqual(before)

    unsub()
  })
})
