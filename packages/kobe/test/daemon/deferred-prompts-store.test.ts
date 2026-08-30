import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFERRED_PROMPT_TTL_MS, DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { afterEach, describe, expect, it, vi } from "vitest"

/** Capture the daemon-log lines the store writes on displacement/expiry. */
function spyDaemonLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }) as typeof process.stderr.write)
  return { lines, restore: () => spy.mockRestore() }
}

describe("daemon deferred-prompts store (issue #78 B)", () => {
  let dir: string | null = null
  let now = 1_000_000

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  async function create(): Promise<{ store: DeferredPromptsStore; path: string }> {
    dir = await mkdtemp(join(tmpdir(), "kobe-deferred-prompts-"))
    const path = join(dir, "deferred-prompts.json")
    const store = new DeferredPromptsStore(path, () => now)
    return { store, path }
  }

  const base = { taskId: "task-1", tabId: "tab-1", prompt: "hello", layer: "composer-not-empty" as const }

  it("files, reads back, and resolves a record", async () => {
    const { store, path } = await create()
    const record = await store.file({ ...base, at: now })
    expect(record.id).toBeTruthy()
    expect(await store.get(record.id)).toEqual(record)
    // Persisted to disk so a daemon restart keeps the queued prompt.
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, records: [record] })

    expect(await store.resolve(record.id)).toBe(true)
    expect(await store.get(record.id)).toBeNull()
    expect(await store.resolve(record.id)).toBe(false)
  })

  it("keeps only the newest record per task+tab, logging the displaced one", async () => {
    const { store, path } = await create()
    const log = spyDaemonLog()
    try {
      const first = await store.file({ ...base, prompt: "first", at: now })
      const second = await store.file({ ...base, prompt: "second", at: now + 1 })

      const records = (JSON.parse(await readFile(path, "utf8")) as { records: unknown[] }).records
      expect(records).toHaveLength(1)
      expect(await store.get(first.id)).toBeNull()
      expect(await store.get(second.id)).toEqual(second)
      // Displacement is explicit, not silent — the dropped record is named by id.
      expect(log.lines.join("")).toContain("displaced deferred prompt")
      expect(log.lines.join("")).toContain(first.id)
    } finally {
      log.restore()
    }
  })

  it("evicts TTL-expired records on write, logging the drop", async () => {
    const { store } = await create()
    const log = spyDaemonLog()
    try {
      const old = await store.file({ ...base, taskId: "task-old", at: now })
      now += DEFERRED_PROMPT_TTL_MS + 1_000
      await store.file({ ...base, taskId: "task-new", at: now })

      expect(await store.get(old.id)).toBeNull()
      expect(log.lines.join("")).toContain("expired deferred prompt")
    } finally {
      log.restore()
    }
  })

  it("deleteTask drops the task's records with a log line", async () => {
    const { store } = await create()
    const log = spyDaemonLog()
    try {
      const a = await store.file({ ...base, at: now })
      const b = await store.file({ ...base, taskId: "task-2", tabId: "tab-1", at: now })

      await store.deleteTask("task-1")
      expect(await store.get(a.id)).toBeNull()
      expect(await store.get(b.id)).toEqual(b)
      expect(log.lines.join("")).toContain("task-1 deleted")
    } finally {
      log.restore()
    }
  })

  it("lists records scoped to one task", async () => {
    const { store } = await create()
    await store.file({ ...base, at: now })
    await store.file({ ...base, taskId: "task-1", tabId: "tab-2", at: now })
    await store.file({ ...base, taskId: "task-2", tabId: "tab-1", at: now })

    const listed = await store.listForTask("task-1")
    expect(listed).toHaveLength(2)
    expect(listed.every((r) => r.taskId === "task-1")).toBe(true)
  })
})
