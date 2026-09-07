/**
 * `deferredPrompt.list` / `.dismiss` — the read + drop half of the Inbox,
 * reachable without a screen.
 *
 * Split from `handlers-deferred.test.ts`, which owns the DELIVERY transaction
 * (file → claim → begin/mark/reset → flush): those tests are about a paste
 * that must happen exactly once. These two RPCs never deliver anything. They
 * exist because releasing a deferred prompt used to be a human action on a
 * screen and nothing else, so an unattended fleet's message sat in the store
 * until the 24h sweep dropped it undelivered.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { DeferredPromptsStore as Store } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import type { DaemonRuntimeAdapter } from "@sma1lboy/kobe-daemon/daemon/runtime"
import { afterEach, describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

describe("deferredPrompt list + dismiss", () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  async function ctxWithStore() {
    const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === TASK.id ? TASK : undefined) })
    dir = await mkdtemp(join(tmpdir(), "kobe-deferred-inbox-"))
    const store = new Store(join(dir, "deferred-prompts.json"))
    ;(ctx as { deferredPrompts?: DeferredPromptsStore }).deferredPrompts = store
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = { ...ctx.runtime, deliveryGuard: () => "screen-off" as const }
    return { ctx, rec, store }
  }

  it("lifts the peer provenance header onto the record and its Inbox episode", async () => {
    // The episode carries an id, never the prompt body, so the card can only
    // name a sender if the daemon lifts it at filing time.
    const { ctx, rec, store } = await ctxWithStore()
    const filed = (await dispatch(
      "deferredPrompt.fileIfVacant",
      {
        taskId: TASK.id,
        tabId: "tab-1",
        prompt: '[ROVE PEER] from "kobe" (task 01ABC)\n\ndo the thing',
        layer: "composer-not-empty",
      },
      ctx,
    )) as { id: string }

    expect((await store.get(filed.id))?.senderLabel).toBe("kobe")
    const episode = rec.inboxPromptDeferred.at(-1)
    expect(episode?.sender).toBe("kobe")
  })

  it("list publishes the live records with an expiry, so a headless caller can act on them", async () => {
    // Releasing a deferred prompt used to be a human action on the Inbox
    // screen and nothing else, so an unattended fleet's message sat until the
    // 24h sweep dropped it undelivered. `list` is the read half of that Inbox.
    const { ctx, store } = await ctxWithStore()
    const filed = (await dispatch(
      "deferredPrompt.fileIfVacant",
      { taskId: TASK.id, tabId: "tab-1", prompt: "held text", layer: "composer-not-empty" },
      ctx,
    )) as { id: string }

    const { records } = (await dispatch("deferredPrompt.list", {}, ctx)) as {
      records: { id: string; prompt: string; at: string; expiresAt: string }[]
    }
    expect(records.map((record) => record.id)).toEqual([filed.id])
    expect(records[0].prompt).toBe("held text")
    // The deadline is derived from the record's own `at`, not from "now" —
    // a caller reading the list an hour later still sees the real expiry.
    const stored = await store.get(filed.id)
    expect(Date.parse(records[0].expiresAt) - Date.parse(records[0].at)).toBe(24 * 60 * 60 * 1000)
    expect(Date.parse(records[0].at)).toBe(stored?.at)
  })

  it("a dismissed record is hidden by default, listed on request, and still releasable", async () => {
    // The whole recovery path for the accident this feature exists for: a
    // dispatcher's instruction dismissed off a card that named no sender. The
    // sender has already exited 0, so "gone" had to stop meaning gone.
    const { ctx, store } = await ctxWithStore()
    const filed = (await dispatch(
      "deferredPrompt.fileIfVacant",
      { taskId: TASK.id, tabId: "tab-1", prompt: "the instruction", layer: "composer-not-empty" },
      ctx,
    )) as { id: string }
    await dispatch("deferredPrompt.dismiss", { id: filed.id }, ctx)
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      deliverPromptToLiveEngineTabDetailed: async () => ({ outcome: "delivered", tabId: "tab-1" }),
    }

    const hidden = (await dispatch("deferredPrompt.list", {}, ctx)) as { records: { id: string }[] }
    expect(hidden.records).toEqual([])

    const shown = (await dispatch("deferredPrompt.list", { includeDismissed: true }, ctx)) as {
      records: { id: string; prompt: string; dismissedAt?: string }[]
    }
    expect(shown.records.map((record) => record.id)).toEqual([filed.id])
    expect(shown.records[0].prompt).toBe("the instruction")
    expect(Date.parse(shown.records[0].dismissedAt ?? "")).toBeGreaterThan(0)

    // ...and release still delivers it, which is what makes the dismiss undoable.
    const released = (await dispatch("deferredPrompt.release", { id: filed.id }, ctx)) as {
      kind: string
      delivered: string[]
    }
    expect(released.kind).toBe("claimed")
    expect(released.delivered).toEqual([filed.id])
    expect(await store.get(filed.id)).toBeNull()
  })

  it("dismiss deletes the Inbox pointer and frees the slot, but KEEPS the text", async () => {
    // Leaving the episode would point at text nobody can reach — the same
    // stranded-pointer shape the release path orders its two deletes to avoid.
    // Deleting the TEXT is the other failure: a stray `d` on a card that named
    // no sender used to destroy a dispatcher's instruction outright, so the
    // record survives to its ordinary TTL and stays releasable.
    const { ctx, rec, store } = await ctxWithStore()
    const filed = (await dispatch(
      "deferredPrompt.fileIfVacant",
      { taskId: TASK.id, tabId: "tab-1", prompt: "unwanted", layer: "composer-not-empty" },
      ctx,
    )) as { id: string }

    const res = (await dispatch("deferredPrompt.dismiss", { id: filed.id }, ctx)) as {
      dismissed: boolean
      record: { prompt: string }
    }
    expect(res.dismissed).toBe(true)
    expect(res.record.prompt).toBe("unwanted")
    expect((await store.get(filed.id))?.prompt).toBe("unwanted")
    expect((await store.get(filed.id))?.dismissedAt).toBeTypeOf("number")
    // Off the queue: the default listing (what `deferred-list` reads) hides it.
    expect((await store.list()).records).toEqual([])
    expect((await store.list()).dismissed.map((r) => r.id)).toEqual([filed.id])
    expect(rec.inboxDeleted).toEqual([{ taskId: TASK.id, tabId: "tab-1" }])
    // The tab's slot is free again: a later filing is accepted, not refused
    // as occupied.
    const next = (await dispatch(
      "deferredPrompt.fileIfVacant",
      { taskId: TASK.id, tabId: "tab-1", prompt: "replacement", layer: "composer-not-empty" },
      ctx,
    )) as { kind: string }
    expect(next.kind).toBe("filed")
  })

  it("dismiss reports false for an id the store no longer holds", async () => {
    const { ctx, rec } = await ctxWithStore()
    expect(await dispatch("deferredPrompt.dismiss", { id: "not-a-record" }, ctx)).toEqual({ dismissed: false })
    expect(rec.inboxDeleted).toEqual([])
  })
})
