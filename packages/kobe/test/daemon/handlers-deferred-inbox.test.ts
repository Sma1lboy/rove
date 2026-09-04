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
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = { ...ctx.runtime, composerGateEnabled: () => false }
    return { ctx, rec, store }
  }

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

  it("dismiss drops the record AND its Inbox pointer, so no phantom item survives", async () => {
    // Dropping only the record would leave the Inbox episode pointing at text
    // that no longer exists — the same stranded-pointer shape the release path
    // orders its two deletes to avoid.
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
    expect(await store.get(filed.id)).toBeNull()
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
