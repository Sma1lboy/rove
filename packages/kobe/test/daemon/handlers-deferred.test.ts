import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { DeferredPromptsStore as Store } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import type { DaemonRuntimeAdapter } from "@sma1lboy/kobe-daemon/daemon/runtime"
import { afterEach, describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

describe("deferredPrompt RPC handlers", () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  async function ctxWithStore() {
    const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === TASK.id ? TASK : undefined) })
    dir = await mkdtemp(join(tmpdir(), "kobe-deferred-handlers-"))
    const store = new Store(join(dir, "deferred-prompts.json"))
    ;(ctx as { deferredPrompts?: DeferredPromptsStore }).deferredPrompts = store
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = { ...ctx.runtime, deliveryGuard: () => "screen-off" as const }
    return { ctx, rec, store }
  }

  it("file stores the text and records a prompt_deferred episode, returning the id", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const res = (await dispatch(
      "deferredPrompt.file",
      { taskId: TASK.id, tabId: "tab-1", prompt: "hi there", layer: "composer-not-empty" },
      ctx,
    )) as { id: string }

    expect(res.id).toBeTruthy()
    const record = await store.get(res.id)
    expect(record?.prompt).toBe("hi there")
    expect(record?.layer).toBe("composer-not-empty")
    // The episode points at the record by id — the prompt text is NOT copied
    // into the episode's EngineActivityDetail.
    expect(rec.inboxPromptDeferred).toEqual([
      { taskId: TASK.id, tabId: "tab-1", deferredId: res.id, layer: "composer-not-empty" },
    ])
  })

  it("fileIfVacant reports an occupied tab without replacing its pending prompt", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const first = (await dispatch(
      "deferredPrompt.fileIfVacant",
      {
        taskId: TASK.id,
        tabId: "tab-1",
        prompt: "first",
        layer: "composer-not-empty",
      },
      ctx,
    )) as { kind: string; id: string }

    const second = (await dispatch(
      "deferredPrompt.fileIfVacant",
      {
        taskId: TASK.id,
        tabId: "tab-1",
        prompt: "second",
        layer: "composer-not-empty",
      },
      ctx,
    )) as { kind: string; id: string; layer?: string; expiresAt?: string }

    expect(first.kind).toBe("filed")
    // `expiresAt` rides every filing reply: it is the only place the sender
    // learns the daemon will drop the text 24h from now if nobody releases it.
    expect(second).toEqual({
      kind: "occupied",
      id: first.id,
      layer: "composer-not-empty",
      expiresAt: second.expiresAt,
    })
    expect(second.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect((await store.get(first.id))?.prompt).toBe("first")
    expect(rec.inboxPromptDeferred).toEqual([
      { taskId: TASK.id, tabId: "tab-1", deferredId: first.id, layer: "composer-not-empty" },
      { taskId: TASK.id, tabId: "tab-1", deferredId: first.id, layer: "composer-not-empty" },
    ])
  })

  it("rebuilds a missing Inbox episode when a filing retry finds the record", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const original = ctx.inbox.recordPromptDeferred.bind(ctx.inbox)
    let fail = true
    ctx.inbox.recordPromptDeferred = async (...args) => {
      if (fail) {
        fail = false
        throw new Error("inbox commit failed")
      }
      return await original(...args)
    }
    const payload = {
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "first",
      layer: "composer-not-empty",
    }

    await expect(dispatch("deferredPrompt.fileIfVacant", payload, ctx)).rejects.toThrow("inbox commit failed")
    const [orphan] = await store.listForTask(TASK.id)
    expect(orphan?.prompt).toBe("first")
    expect(rec.inboxPromptDeferred).toEqual([])

    await expect(dispatch("deferredPrompt.fileIfVacant", payload, ctx)).resolves.toMatchObject({
      kind: "occupied",
      id: orphan?.id,
      layer: "composer-not-empty",
    })
    expect(rec.inboxPromptDeferred).toEqual([
      { taskId: TASK.id, tabId: "tab-1", deferredId: orphan?.id, layer: "composer-not-empty" },
    ])
  })

  it("rejects an occupied tab for clients that do not request a structured conflict", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const first = (await dispatch(
      "deferredPrompt.file",
      { taskId: TASK.id, tabId: "tab-1", prompt: "first", layer: "composer-not-empty" },
      ctx,
    )) as { id: string }

    await expect(
      dispatch(
        "deferredPrompt.file",
        { taskId: TASK.id, tabId: "tab-1", prompt: "second", layer: "composer-not-empty" },
        ctx,
      ),
    ).rejects.toThrow(/already has a deferred prompt/)

    expect((await store.get(first.id))?.prompt).toBe("first")
    expect(rec.inboxPromptDeferred).toEqual([
      { taskId: TASK.id, tabId: "tab-1", deferredId: first.id, layer: "composer-not-empty" },
      { taskId: TASK.id, tabId: "tab-1", deferredId: first.id, layer: "composer-not-empty" },
    ])
  })

  it("file rejects a bad layer and an unknown task", async () => {
    const { ctx } = await ctxWithStore()
    await expect(
      dispatch("deferredPrompt.file", { taskId: TASK.id, tabId: "tab-1", prompt: "x", layer: "bogus" }, ctx),
    ).rejects.toThrow(/layer must be/)
    await expect(
      dispatch(
        "deferredPrompt.file",
        { taskId: "nope", tabId: "tab-1", prompt: "x", layer: "composer-not-empty" },
        ctx,
      ),
    ).rejects.toThrow(/task not found/)
  })

  it("fails the legacy pre-claim read path loud and resolves a pre-restart insert through a claim", async () => {
    const { ctx, store } = await ctxWithStore()
    const { id } = (await dispatch(
      "deferredPrompt.file",
      { taskId: TASK.id, tabId: "tab-1", prompt: "queued", layer: "recent-human-write" },
      ctx,
    )) as { id: string }

    await expect(dispatch("deferredPrompt.get", { id }, ctx)).rejects.toThrow(
      "legacy deferred prompt release is unsafe",
    )

    await expect(dispatch("deferredPrompt.resolve", { id }, ctx)).resolves.toMatchObject({ removed: true })
    expect(await store.get(id)).toBeNull()
  })

  it("resolve drops BOTH the record and the pointing inbox episode", async () => {
    const { ctx, rec } = await ctxWithStore()
    const { id } = (await dispatch(
      "deferredPrompt.file",
      { taskId: TASK.id, tabId: "tab-1", prompt: "queued", layer: "composer-not-empty" },
      ctx,
    )) as { id: string }

    await dispatch("deferredPrompt.resolve", { id }, ctx)
    expect(rec.inboxDeleted).toEqual([{ taskId: TASK.id, tabId: "tab-1" }])
  })

  it("flush delivers every queued prompt in file order and resolves each episode", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const now = Date.now()
    const first = await store.file({
      taskId: TASK.id,
      tabId: "tab-2",
      prompt: "first",
      layer: "composer-not-empty",
      at: now,
    })
    const second = await store.file({
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "second",
      layer: "composer-not-empty",
      at: now + 1,
    })
    const delivered: Array<{ tabId: string; prompt: string }> = []
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      deliverPromptToLiveEngineTabDetailed: async (target, prompt) => {
        delivered.push({ tabId: target.tabId, prompt })
        return { outcome: "delivered", tabId: target.tabId }
      },
    }

    const result = await dispatch("deferredPrompt.flush", {}, ctx)

    expect(delivered).toEqual([
      { tabId: "tab-2", prompt: "first" },
      { tabId: "tab-1", prompt: "second" },
    ])
    expect(result).toEqual({
      delivered: [first.id, second.id],
      cleaned: [first.id, second.id],
      expired: [],
      retained: [],
      cleanupPending: [],
    })
    expect(await store.get(first.id)).toBeNull()
    expect(await store.get(second.id)).toBeNull()
    expect(rec.inboxDeleted).toEqual([
      { taskId: TASK.id, tabId: "tab-2" },
      { taskId: TASK.id, tabId: "tab-1" },
    ])
  })

  it("flush keeps a mid-queue failure visible and continues with later tabs", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const now = Date.now()
    const first = await store.file({
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "first",
      layer: "composer-not-empty",
      at: now,
    })
    const blocked = await store.file({
      taskId: TASK.id,
      tabId: "tab-2",
      prompt: "blocked",
      layer: "composer-not-empty",
      at: now + 1,
    })
    const third = await store.file({
      taskId: TASK.id,
      tabId: "tab-3",
      prompt: "third",
      layer: "composer-not-empty",
      at: now + 2,
    })
    const attempted: string[] = []
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      deliverPromptToLiveEngineTabDetailed: async (target) => {
        attempted.push(target.tabId)
        if (target.tabId === "tab-2") {
          return { outcome: "busy", tabId: target.tabId, layer: "recent-human-write" }
        }
        return { outcome: "delivered", tabId: target.tabId }
      },
    }

    const result = await dispatch("deferredPrompt.flush", {}, ctx)

    expect(attempted).toEqual(["tab-1", "tab-2", "tab-3"])
    expect(result).toEqual({
      delivered: [first.id, third.id],
      cleaned: [first.id, third.id],
      expired: [],
      retained: [
        {
          id: blocked.id,
          taskId: TASK.id,
          tabId: "tab-2",
          reason: "busy",
          layer: "recent-human-write",
        },
      ],
      cleanupPending: [],
    })
    expect(await store.get(first.id)).toBeNull()
    expect(await store.get(blocked.id)).toEqual(blocked)
    expect(await store.get(third.id)).toBeNull()
    expect(rec.inboxDeleted).toEqual([
      { taskId: TASK.id, tabId: "tab-1" },
      { taskId: TASK.id, tabId: "tab-3" },
    ])
  })

  it("single-flights concurrent flush, release, and dismiss operations", async () => {
    const { ctx, store } = await ctxWithStore()
    const queued = await store.file({
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "once",
      layer: "composer-not-empty",
      at: Date.now(),
    })
    let enterDelivery = () => {}
    const entered = new Promise<void>((resolve) => {
      enterDelivery = resolve
    })
    let finishDelivery = () => {}
    const finish = new Promise<void>((resolve) => {
      finishDelivery = resolve
    })
    let deliveries = 0
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      deliveryGuard: () => "screen-off" as const,
      deliverPromptToLiveEngineTabDetailed: async () => {
        deliveries++
        enterDelivery()
        await finish
        return { outcome: "delivered", tabId: "tab-1" }
      },
    }
    ;(ctx.inbox as unknown as { snapshot: () => unknown[] }).snapshot = () => [
      { taskId: TASK.id, tabId: "tab-1", state: "prompt_deferred", unread: true, at: queued.at },
    ]

    const firstFlush = dispatch("deferredPrompt.flush", {}, ctx)
    await entered
    const competing = Promise.all([
      dispatch("deferredPrompt.flush", {}, ctx),
      dispatch("deferredPrompt.release", { id: queued.id }, ctx),
      dispatch("attention.dismiss", { taskId: TASK.id, tabId: "tab-1", at: queued.at }, ctx),
    ])
    finishDelivery()
    await Promise.all([firstFlush, competing])

    expect(deliveries).toBe(1)
    expect(await store.get(queued.id)).toBeNull()
  })

  it("persists delivery before Inbox cleanup and converges without redelivery after an injected fault", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const queued = await store.file({
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "exactly once",
      layer: "composer-not-empty",
      at: Date.now(),
    })
    let deliveries = 0
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      deliveryGuard: () => "screen-off" as const,
      deliverPromptToLiveEngineTabDetailed: async () => {
        deliveries++
        return { outcome: "delivered", tabId: "tab-1" }
      },
    }
    const deleteEpisode = ctx.inbox.deleteEpisode.bind(ctx.inbox)
    let failCleanup = true
    ctx.inbox.deleteEpisode = async (...args) => {
      if (failCleanup) {
        failCleanup = false
        throw new Error("inbox rename failed")
      }
      return await deleteEpisode(...args)
    }

    const first = await dispatch("deferredPrompt.flush", {}, ctx)
    expect(first).toMatchObject({ delivered: [queued.id], cleanupPending: [{ id: queued.id }] })
    expect((await store.get(queued.id))?.deliveredAt).toEqual(expect.any(Number))

    const retry = await dispatch("deferredPrompt.flush", {}, ctx)
    expect(retry).toMatchObject({ delivered: [], cleaned: [queued.id], cleanupPending: [] })
    expect(deliveries).toBe(1)
    expect(await store.get(queued.id)).toBeNull()
    expect(rec.inboxDeleted).toEqual([{ taskId: TASK.id, tabId: "tab-1" }])
  })

  it("cancels the remaining flush generation when the composer gate is re-enabled", async () => {
    const { ctx, store } = await ctxWithStore()
    const first = await store.file({
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "first",
      layer: "composer-not-empty",
      at: Date.now(),
    })
    const second = await store.file({
      taskId: TASK.id,
      tabId: "tab-2",
      prompt: "second",
      layer: "composer-not-empty",
      at: Date.now() + 1,
    })
    let guard: "on" | "screen-off" | "off" = "screen-off"
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      deliveryGuard: () => guard,
      deliverPromptToLiveEngineTabDetailed: async (_target, _prompt) => {
        guard = "on"
        return { outcome: "delivered", tabId: "tab-1" }
      },
    }

    const result = await dispatch("deferredPrompt.flush", {}, ctx)
    expect(result).toMatchObject({
      delivered: [first.id],
      retained: [{ id: second.id, reason: "gate-enabled" }],
    })
    expect(await store.get(second.id)).toEqual(second)
  })

  it("returns TTL-pruned ids and turns their Inbox pointers into an expired notice", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const expired = await store.file({
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "expired",
      layer: "composer-not-empty",
      at: Date.now() - 24 * 60 * 60 * 1000 - 1,
    })

    const result = await dispatch("deferredPrompt.flush", {}, ctx)
    expect(result).toMatchObject({ expired: [expired.id], delivered: [] })
    // The row is REPLACED, not deleted — a human triggered this flush, but the
    // SENDER is still owed the news that their text was never delivered, and
    // the flush result never reaches them.
    expect(rec.inboxDeleted).toEqual([])
    expect(rec.inboxPromptExpired).toEqual([{ taskId: TASK.id, tabId: "tab-1", deferredId: expired.id }])
  })

  it("dismissing retires a stored prompt and closing its tab drops one, both with their Inbox episode", async () => {
    const { ctx, rec, store } = await ctxWithStore()
    const now = Date.now()
    const dismissed = await store.file({
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "dismiss me",
      layer: "composer-not-empty",
      at: now,
    })
    const closed = await store.file({
      taskId: TASK.id,
      tabId: "tab-2",
      prompt: "close me",
      layer: "composer-not-empty",
      at: now + 1,
    })
    ;(ctx.inbox as unknown as { snapshot: () => unknown[] }).snapshot = () => [
      {
        taskId: TASK.id,
        tabId: "tab-1",
        state: "prompt_deferred",
        detail: { deferredPrompt: { id: dismissed.id, layer: "composer-not-empty" } },
        unread: true,
        at: now,
      },
    ]

    await dispatch("attention.dismiss", { taskId: TASK.id, tabId: "tab-1", at: now }, ctx)
    await dispatch("ui.reportEvent", { kind: "tab.closed", taskId: TASK.id, detail: { tabId: "tab-2" } }, ctx)

    // Dismiss retires the record from the queue but keeps its text; closing a
    // tab drops it outright, because there is nothing left to release it into.
    expect((await store.get(dismissed.id))?.dismissedAt).toBeTypeOf("number")
    expect((await store.list()).records).toEqual([])
    expect(await store.get(closed.id)).toBeNull()
    expect(rec.inboxDeleted).toContainEqual({ taskId: TASK.id, tabId: "tab-2" })
  })

  it("does not discard a newer deferred prompt for a stale Inbox dismissal", async () => {
    const { ctx, store } = await ctxWithStore()
    const now = Date.now()
    const queued = await store.file({
      taskId: TASK.id,
      tabId: "tab-1",
      prompt: "newer",
      layer: "composer-not-empty",
      at: now,
    })
    ;(ctx.inbox as unknown as { snapshot: () => unknown[] }).snapshot = () => [
      { taskId: TASK.id, tabId: "tab-1", state: "prompt_deferred", unread: true, at: now + 1 },
    ]

    await dispatch("attention.dismiss", { taskId: TASK.id, tabId: "tab-1", at: now }, ctx)

    expect(await store.get(queued.id)).toEqual(queued)
  })
})
