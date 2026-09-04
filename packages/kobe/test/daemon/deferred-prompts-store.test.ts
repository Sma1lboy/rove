import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFERRED_PROMPT_TTL_MS, DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { afterEach, describe, expect, it, vi } from "vitest"

/** Capture the daemon-log lines the store writes on expiry or explicit discard. */
function spyDaemonLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }) as typeof process.stderr.write)
  return { lines, restore: () => spy.mockRestore() }
}

describe("daemon deferred-prompts store", () => {
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

  it("keeps the first record per task+tab and rejects a later deferral", async () => {
    const { store, path } = await create()
    const first = await store.file({ ...base, prompt: "first", at: now })

    await expect(store.file({ ...base, prompt: "second", at: now + 1 })).rejects.toThrow(
      /already has a deferred prompt/,
    )

    const records = (JSON.parse(await readFile(path, "utf8")) as { records: unknown[] }).records
    expect(records).toEqual([first])
    expect(await store.get(first.id)).toEqual(first)
  })

  it("returns TTL-expired records to the caller instead of silently dropping their Inbox identity", async () => {
    const { store } = await create()
    const log = spyDaemonLog()
    try {
      const old = await store.file({ ...base, taskId: "task-old", at: now })
      now += DEFERRED_PROMPT_TTL_MS + 1_000
      const fresh = await store.file({ ...base, taskId: "task-new", at: now })

      expect(await store.get(old.id)).toEqual(old)
      expect(await store.list()).toEqual({ records: [fresh], expired: [old] })
      expect(log.lines.join("")).toContain("expired deferred prompt")
    } finally {
      log.restore()
    }
  })

  it("blocks same-tab replacement while expiry cleanup owns the record", async () => {
    const { store } = await create()
    const old = await store.file({ ...base, at: now })
    now += DEFERRED_PROMPT_TTL_MS + 1
    const claimed = await store.claim(old.id)
    expect(claimed.kind).toBe("claimed")
    await expect(store.file({ ...base, prompt: "new", at: now })).rejects.toThrow("cleanup is in flight")
    if (claimed.kind !== "claimed") throw new Error("claim missing")
    await store.completeClaim(claimed.claim)

    const fresh = await store.file({ ...base, prompt: "new", at: now })
    expect(await store.listForTask(base.taskId)).toEqual([fresh])
  })

  it("replaces an expired record in the same tab without leaving a duplicate cleanup target", async () => {
    const { store } = await create()
    const old = await store.file({ ...base, at: now })
    now += DEFERRED_PROMPT_TTL_MS + 1_000

    const fresh = await store.file({ ...base, prompt: "fresh", at: now })

    expect(await store.get(old.id)).toBeNull()
    expect(await store.list()).toEqual({ records: [fresh], expired: [] })
  })

  it("does not let an unrelated expired claim block filing another tab", async () => {
    const { store } = await create()
    const old = await store.file({ ...base, at: now })
    now += DEFERRED_PROMPT_TTL_MS + 1_000
    expect(await store.claim(old.id)).toMatchObject({ kind: "claimed" })

    const fresh = await store.file({ ...base, tabId: "tab-2", prompt: "fresh", at: now })

    expect(await store.get(fresh.id)).toEqual(fresh)
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

  it("discardTab removes only that tab and logs why the prompt was dropped", async () => {
    const { store } = await create()
    const log = spyDaemonLog()
    try {
      const dropped = await store.file({ ...base, at: now })
      const kept = await store.file({ ...base, tabId: "tab-2", at: now + 1 })

      expect(await store.discardTab("task-1", "tab-1", "tab closed")).toEqual([dropped])
      expect(await store.get(dropped.id)).toBeNull()
      expect(await store.get(kept.id)).toEqual(kept)
      expect(log.lines.join("")).toContain(`dropped deferred prompt ${dropped.id}`)
      expect(log.lines.join("")).toContain("tab closed")
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
