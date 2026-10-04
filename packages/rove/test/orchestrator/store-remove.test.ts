/**
 * TaskIndexStore branches store-load-edge/store-concurrency leave out:
 * remove() from cache and disk, the no-op remove, and the compact file format.
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
})
