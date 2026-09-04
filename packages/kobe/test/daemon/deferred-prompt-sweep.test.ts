import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AttentionInboxStore } from "@sma1lboy/kobe-daemon/daemon/attention-inbox"
import {
  DEFAULT_DEFERRED_SWEEP_TICK_MS,
  startDeferredPromptSweep,
  sweepExpiredDeferredPrompts,
} from "@sma1lboy/kobe-daemon/daemon/deferred-prompt-sweep"
import { DEFERRED_PROMPT_TTL_MS, DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The deferred-prompt TTL drainer.
 *
 * `DEFERRED_PROMPT_TTL_MS` was dead policy: `list()` is the only method that
 * computes `expired`, and its only caller was `deferredPrompt.flush`, which a
 * human reaches by opening Settings and toggling the composer gate. So a
 * parked prompt sat on disk forever with a permanent `prompt_deferred` Inbox
 * row — `attentionInboxItemKey` gives that episode its own lane, so no later
 * turn on the tab cleared it either.
 */

type DeleteEpisode = AttentionInboxStore["deleteEpisode"]
type DeletedEpisode = Parameters<DeleteEpisode>

function fakeInbox(): { deleteEpisode: DeleteEpisode; deleted: DeletedEpisode[] } {
  const deleted: DeletedEpisode[] = []
  return {
    deleted,
    async deleteEpisode(...args: DeletedEpisode) {
      deleted.push(args)
      return true
    },
  }
}

describe("deferred-prompt expiry sweep", () => {
  let dir: string | null = null
  let now = 1_000_000

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
    now = 1_000_000
  })

  async function create(): Promise<{ store: DeferredPromptsStore; path: string }> {
    dir = await mkdtemp(join(tmpdir(), "kobe-deferred-sweep-"))
    const path = join(dir, "deferred-prompts.json")
    return { store: new DeferredPromptsStore(path, () => now), path }
  }

  const base = { taskId: "task-1", tabId: "tab-1", prompt: "held text", layer: "composer-not-empty" as const }

  it("drops a past-TTL record and its Inbox pointer", async () => {
    const { store, path } = await create()
    const record = await store.file({ ...base, at: now })
    now += DEFERRED_PROMPT_TTL_MS + 1

    const inbox = fakeInbox()
    const report = await sweepExpiredDeferredPrompts({ store, inbox })

    expect(report.expired).toEqual([record.id])
    expect(report.cleanupPending).toEqual([])
    // The Inbox pointer goes with it: the row is keyed by the deferred id in
    // its own `prompt_deferred` lane, so nothing else would ever clear it.
    expect(inbox.deleted).toEqual([["task-1", "tab-1", undefined, "prompt_deferred", record.id]])
    // …and the record is gone from disk, not just from the in-memory list.
    expect(JSON.parse(await readFile(path, "utf8")).records).toEqual([])
  })

  it("leaves a live record alone — the timer expires, it never delivers", async () => {
    // The load-bearing half of the split: `flushDeferredPrompts` re-attempts
    // DELIVERY for every non-expired record, and that is a deliberate
    // human-triggered action (the composer gate just turned off). A timer
    // that also redelivered would paste into a composer nobody asked it to.
    const { store, path } = await create()
    const record = await store.file({ ...base, at: now })
    now += DEFERRED_PROMPT_TTL_MS - 1

    const inbox = fakeInbox()
    const report = await sweepExpiredDeferredPrompts({ store, inbox })

    expect(report.expired).toEqual([])
    expect(inbox.deleted).toEqual([])
    expect(JSON.parse(await readFile(path, "utf8")).records).toHaveLength(1)
    expect(await store.get(record.id)).not.toBeNull()
  })

  it("reports a record whose Inbox deletion failed instead of orphaning the row", async () => {
    const { store } = await create()
    const record = await store.file({ ...base, at: now })
    now += DEFERRED_PROMPT_TTL_MS + 1

    const report = await sweepExpiredDeferredPrompts({
      store,
      inbox: {
        deleteEpisode: async () => {
          throw new Error("inbox write failed")
        },
      },
    })

    expect(report.expired).toEqual([])
    expect(report.cleanupPending).toEqual([
      { id: record.id, taskId: "task-1", tabId: "tab-1", error: "inbox write failed" },
    ])
    // Still on disk, so the next pass retries rather than leaving an Inbox row
    // pointing at a record that no longer exists.
    expect(await store.get(record.id)).not.toBeNull()
  })

  it("runs a pass immediately, before the first interval — this is the boot sweep", async () => {
    const { store } = await create()
    const record = await store.file({ ...base, at: now })
    now += DEFERRED_PROMPT_TTL_MS + 1

    const inbox = fakeInbox()
    // A tick period far longer than the test: anything cleaned here came from
    // the immediate pass, which is what makes a daemon restart clear records
    // that went stale while it was down.
    const stop = startDeferredPromptSweep({ store, inbox }, DEFAULT_DEFERRED_SWEEP_TICK_MS)
    try {
      await vi.waitFor(() => expect(inbox.deleted).toHaveLength(1))
      expect(await store.get(record.id)).toBeNull()
    } finally {
      stop()
    }
  })
})
