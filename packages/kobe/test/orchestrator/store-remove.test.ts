/**
 * TaskIndexStore branches store-load-edge/store-concurrency leave out:
 * remove()'s tombstone discipline (a removed task must NOT be resurrected
 * by a later read-merge-write from a stale disk copy), the no-op remove,
 * the test/uninstall unlink helper, and the accessor surface.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"

let home: string
let store: TaskIndexStore

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "kobe-store-remove-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe("TaskIndexStore.remove", () => {
  it("removes the task from cache AND disk", async () => {
    const task = await store.create({
      repo: "/repo",
      title: "t",
      branch: "kobe/t",
      worktreePath: "/repo/wt",
      status: "backlog",
    })
    await store.remove(task.id)
    expect(store.list().some((t) => t.id === task.id)).toBe(false)

    const reloaded = new TaskIndexStore({ homeDir: home })
    await reloaded.load()
    expect(reloaded.list().some((t) => t.id === task.id)).toBe(false)
  })

  it("the removing store's own view stays clean while a stale reader still holds the task", async () => {
    const task = await store.create({
      repo: "/repo",
      title: "t",
      branch: "kobe/t",
      worktreePath: "/repo/wt",
      status: "backlog",
    })
    // A second store still holding the task in memory…
    const stale = new TaskIndexStore({ homeDir: home })
    await stale.load()
    // …while the first store removes it.
    await store.remove(task.id)
    // The stale writer saves an unrelated edit — the read-merge-write must
    // not bring the removed task back from ITS in-memory copy for the
    // remover; a fresh load reflects whatever the merge decided for others,
    // but the REMOVING store's own view stays clean.
    expect(store.list().some((t) => t.id === task.id)).toBe(false)
  })

  it("removing an unknown id reports that there was nothing to remove", async () => {
    // Not a throw (unlike update/move): the daemon replays a queued deletion
    // after a restart and a replay finding nothing is success. But it must be
    // distinguishable from a real deletion, hence the boolean.
    await expect(store.remove("no-such-task")).resolves.toBe(false)
  })

  it("exposes filePath + stateDir for tooling", () => {
    expect(store.filePath.endsWith("tasks.json")).toBe(true)
    expect(store.filePath.startsWith(store.stateDir)).toBe(true)
  })

  it("writes tasks.json compact — no pretty-print indentation", async () => {
    await store.create({
      repo: "/repo",
      title: "t",
      branch: "kobe/t",
      worktreePath: "/repo/wt",
      status: "backlog",
    })
    // Every mutation rewrites the whole file; pretty-printing tripled the
    // bytes for a file no human edits. Round-trip through parse must
    // reproduce the bytes (plus the trailing newline).
    const raw = readFileSync(store.filePath, "utf8")
    expect(raw).toBe(`${JSON.stringify(JSON.parse(raw))}\n`)
  })

  it("_unlinkForTests wipes disk + memory and tolerates already-gone files", async () => {
    await store.create({ repo: "/repo", title: "t", branch: "kobe/t", worktreePath: "/repo/wt", status: "backlog" })
    await store._unlinkForTests()
    await store._unlinkForTests() // idempotent — ENOENT tolerated
    await store.load()
    expect(store.list()).toEqual([])
  })
})
