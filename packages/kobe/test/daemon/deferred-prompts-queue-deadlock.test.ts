/**
 * `discard()` waits for an in-flight claim BEFORE it takes the store's write
 * queue, not from inside it. Returning `claim.done` bare from the enqueued
 * callback made the slot adopt that promise, so the slot could only settle
 * once the claim did — while the claim's own `releaseClaim`/`markDelivered`
 * were queued behind that same slot. The cycle wedged every later caller:
 * seven task deletions sat at `phase=running` for two hours because
 * `deleteTask` → `waitForClaims` never reached the front of the queue.
 *
 * The first test below is the concurrency contract (it fails on the bare
 * return); the second is the discard SEMANTICS the fix must not change, and
 * deliberately stays green under that same mutation.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** Resolves to "TIMEOUT" instead of hanging the runner when the queue wedges. */
function within<T>(work: Promise<T>, ms = 200): Promise<T | "TIMEOUT"> {
  return Promise.race([
    work,
    new Promise<"TIMEOUT">((resolve) => {
      setTimeout(() => resolve("TIMEOUT"), ms).unref?.()
    }),
  ])
}

describe("deferred-prompts store queue under an in-flight claim", () => {
  let dir: string | null = null
  let path = ""
  const now = 1_000_000
  const base = { tabId: "tab-1", prompt: "queued text", layer: "composer-not-empty" as const }

  beforeEach(async () => {
    // Silence the discard's daemon-log line; the assertions are the contract.
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write)
    dir = await mkdtemp(join(tmpdir(), "kobe-deferred-deadlock-"))
    path = join(dir, "deferred-prompts.json")
  })

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
    vi.restoreAllMocks()
  })

  const create = () => new DeferredPromptsStore(path, () => now)

  /** Read the records off disk — the one look that never touches the queue. */
  async function recordIdsOnDisk(): Promise<string[]> {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { records: { id: string }[] }
    return parsed.records.map((record) => record.id)
  }

  it("keeps serving the store while a discard waits on a live claim", async () => {
    const store = create()
    const held = await store.file({ ...base, taskId: "task-held", at: now })
    await store.file({ ...base, taskId: "task-other", at: now })

    const claimed = await store.claim(held.id)
    if (claimed.kind !== "claimed") throw new Error(`expected a claim, got ${claimed.kind}`)

    // A dismiss arriving mid-delivery: it must WAIT for the claim, not sit on
    // the queue while it waits.
    const discarding = store.discard(held.id, "Inbox item dismissed")
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Asserted together so a regression reports every wedged path, not just
    // whichever one `expect` reached first.
    const settled = {
      list: (await within(store.list())) === "TIMEOUT" ? "TIMEOUT" : "ok",
      // The incident's own path: task deletion drains another task's records.
      deleteTask: (await within(store.deleteTask("task-other"))) === "TIMEOUT" ? "TIMEOUT" : "ok",
      // The claim's settle path is the deadlock's other half — it is what
      // `discard` waits FOR, so it must never queue behind it.
      releaseClaim: (await within(store.releaseClaim(claimed.claim))) === "TIMEOUT" ? "TIMEOUT" : "ok",
    }
    expect(settled).toEqual({ list: "ok", deleteTask: "ok", releaseClaim: "ok" })

    // Released, so the discard resumes and drops exactly its own record.
    const dropped = await within(discarding, 2_000)
    expect(dropped).not.toBe("TIMEOUT")
    expect((dropped as { id: string } | null)?.id).toBe(held.id)
    expect(await recordIdsOnDisk()).toEqual([])
  })

  it("never drops a claimed record out from under its claim", async () => {
    const store = create()
    const claimedRecord = await store.file({ ...base, taskId: "task-held", at: now })
    const sibling = await store.file({ ...base, taskId: "task-other", at: now })

    const claimed = await store.claim(claimedRecord.id)
    if (claimed.kind !== "claimed") throw new Error(`expected a claim, got ${claimed.kind}`)

    const discarding = store.discard(claimedRecord.id, "Inbox item dismissed")
    void discarding.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    // The claim owns the delivery transaction, so a dismiss may not erase the
    // record while that transaction is open — it waits for it.
    expect(await recordIdsOnDisk()).toEqual([claimedRecord.id, sibling.id])
  })

  it("drops exactly the record it names when no claim is in flight", async () => {
    const store = create()
    const target = await store.file({ ...base, taskId: "task-a", at: now })
    const keep = await store.file({ ...base, taskId: "task-b", at: now })

    expect((await store.discard(target.id, "Inbox item dismissed"))?.id).toBe(target.id)
    expect(await recordIdsOnDisk()).toEqual([keep.id])
    expect(await store.discard(target.id, "Inbox item dismissed")).toBeNull()
  })
})
