/**
 * TaskIndexStore runtime-contract edges: the loaded-guard, update/move error
 * paths, the subscribe contract (eager fire, unsubscribe, throwing listener
 * isolation), and the remove convenience. load() recovery lives in
 * `store-load-edge.test.ts`.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { flushClientLog } from "@sma1lboy/kobe-daemon/client/client-log"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"

let home: string
let store: TaskIndexStore

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "kobe-store-edge-"))
  store = new TaskIndexStore({ homeDir: home })
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function writeManifest(content: string): Promise<void> {
  await rm(store.filePath, { force: true })
  await writeFile(store.filePath, content, "utf8")
}

async function primeDir(): Promise<void> {
  // Create <home>/.rove by letting the store write once.
  await store.load()
  await store.create({
    repo: "/r",
    title: "seed",
    branch: "",
    worktreePath: "",
    status: "backlog",
    kind: "task",
    vendor: "claude",
  })
}

describe("loaded guard", () => {
  it("reads before load() throw the call-load-first error", () => {
    expect(() => store.list()).toThrow(/call load\(\)/)
    expect(() => store.get("x")).toThrow(/call load\(\)/)
  })
})

describe("update / move / remove edges", () => {
  beforeEach(async () => {
    await store.load()
  })

  it("update throws for an unknown id", async () => {
    await expect(store.update("missing", { title: "x" })).rejects.toThrow(/task not found/)
  })

  it("update refuses to change id/createdAt but bumps updatedAt", async () => {
    const t = await store.create({
      repo: "/r",
      title: "a",
      branch: "",
      worktreePath: "",
      status: "backlog",
      kind: "task",
      vendor: "claude",
    })
    const next = await store.update(t.id, {
      id: "hijacked",
      createdAt: "1999-01-01T00:00:00.000Z",
      title: "b",
    } as never)
    expect(next.id).toBe(t.id)
    expect(next.createdAt).toBe(t.createdAt)
    expect(next.title).toBe("b")
    expect(next.updatedAt >= t.updatedAt).toBe(true)
  })

  it("move throws for an unknown id and for an id outside the given group", async () => {
    const t = await store.create({
      repo: "/r",
      title: "a",
      branch: "",
      worktreePath: "",
      status: "backlog",
      kind: "task",
      vendor: "claude",
    })
    await expect(store.move("missing", 1)).rejects.toThrow(/task not found/)
    await expect(store.move(t.id, 1, ["other-id"])).rejects.toThrow(/not movable/)
  })

  it("remove is a silent no-op for an unknown id", async () => {
    await expect(store.remove("missing")).resolves.toBeUndefined()
  })
})

describe("subscribe contract", () => {
  it("fires eagerly with the current snapshot when already loaded, and unsubscribes cleanly", async () => {
    await store.load()
    const seen: number[] = []
    const unsub = store.subscribe((snapshot) => {
      seen.push(snapshot.length)
    })
    expect(seen).toEqual([0]) // eager fire on subscribe
    await store.create({
      repo: "/r",
      title: "a",
      branch: "",
      worktreePath: "",
      status: "backlog",
      kind: "task",
      vendor: "claude",
    })
    expect(seen.at(-1)).toBe(1)
    unsub()
    await store.create({
      repo: "/r",
      title: "b",
      branch: "",
      worktreePath: "",
      status: "backlog",
      kind: "task",
      vendor: "claude",
    })
    expect(seen.at(-1)).toBe(1)
  })

  it("does not fire eagerly before load(), then delivers the load() snapshot", async () => {
    const seen: number[] = []
    store.subscribe((snapshot) => {
      seen.push(snapshot.length)
    })
    expect(seen).toEqual([])
    await store.load()
    expect(seen).toEqual([0])
  })

  it("a throwing listener is isolated — other listeners still get notified", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await store.load()
    store.subscribe(() => {
      throw new Error("bad listener")
    })
    const seen: number[] = []
    store.subscribe((snapshot) => {
      seen.push(snapshot.length)
    })
    await store.create({
      repo: "/r",
      title: "a",
      branch: "",
      worktreePath: "",
      status: "backlog",
      kind: "task",
      vendor: "claude",
    })
    expect(seen.at(-1)).toBe(1)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
