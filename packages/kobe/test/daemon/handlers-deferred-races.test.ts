import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AttentionInboxStore } from "@sma1lboy/kobe-daemon/daemon/attention-inbox"
import type { DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { DeferredPromptsStore as Store } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import type { DaemonRuntimeAdapter } from "@sma1lboy/kobe-daemon/daemon/runtime"
import { afterEach, describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

describe("deferredPrompt RPC persistence races", () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  async function ctxWithRealStores(now: () => number = Date.now) {
    const { ctx } = fakeCtx({
      getTask: (id: string) => (id === TASK.id ? TASK : undefined),
    })
    dir = await mkdtemp(join(tmpdir(), "kobe-deferred-real-stores-"))
    const deferredPath = join(dir, "deferred-prompts.json")
    const store = new Store(deferredPath, now)
    const inbox = new AttentionInboxStore(join(dir, "attention-inbox.json"), new DaemonEventBus(), now)
    await inbox.init()
    ;(ctx as { deferredPrompts?: DeferredPromptsStore }).deferredPrompts = store
    ;(ctx as { inbox: AttentionInboxStore }).inbox = inbox
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      composerGateEnabled: () => false,
    }
    return { ctx, store, deferredPath, inbox }
  }

  it("does not redeliver an ambiguous PTY write after a daemon restart", async () => {
    const { ctx, store, deferredPath } = await ctxWithRealStores()
    const { id } = (await dispatch(
      "deferredPrompt.fileIfVacant",
      {
        taskId: TASK.id,
        tabId: "tab-1",
        prompt: "at most once",
        layer: "composer-not-empty",
      },
      ctx,
    )) as { id: string }
    let deliveries = 0
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      composerGateEnabled: () => false,
      deliverPromptToLiveEngineTabDetailed: async () => {
        deliveries++
        throw new Error("transport lost after PTY write")
      },
    }

    await expect(dispatch("deferredPrompt.flush", {}, ctx)).resolves.toMatchObject({
      delivered: [],
      cleanupPending: [{ id }],
    })
    expect((await store.get(id))?.deliveryStartedAt).toEqual(expect.any(Number))

    const restarted = new Store(deferredPath)
    ;(ctx as { deferredPrompts?: DeferredPromptsStore }).deferredPrompts = restarted
    await expect(dispatch("deferredPrompt.flush", {}, ctx)).resolves.toMatchObject({ cleaned: [id], delivered: [] })
    expect(deliveries).toBe(1)
    expect(await restarted.get(id)).toBeNull()
  })

  it("delivery cleanup removes only the deferred Inbox lane", async () => {
    let now = 100
    const { ctx, inbox } = await ctxWithRealStores(() => now)
    await inbox.record(TASK.id, "awaiting-input", { waiting: "permission" }, "tab-1")
    now = 200
    await dispatch(
      "deferredPrompt.fileIfVacant",
      {
        taskId: TASK.id,
        tabId: "tab-1",
        prompt: "deliver",
        layer: "composer-not-empty",
      },
      ctx,
    )
    ;(ctx as { runtime: DaemonRuntimeAdapter }).runtime = {
      ...ctx.runtime,
      composerGateEnabled: () => false,
      deliverPromptToLiveEngineTabDetailed: async () => ({
        outcome: "delivered",
        tabId: "tab-1",
      }),
    }

    await dispatch("deferredPrompt.flush", {}, ctx)

    expect(inbox.snapshot()).toEqual([
      expect.objectContaining({
        state: "permission_needed",
        taskId: TASK.id,
        tabId: "tab-1",
        at: 100,
      }),
    ])
  })

  it("does not discard a TTL replacement racing an old Inbox dismissal", async () => {
    let now = Date.now()
    const { ctx, store, inbox } = await ctxWithRealStores(() => now)
    const old = (await dispatch(
      "deferredPrompt.fileIfVacant",
      {
        taskId: TASK.id,
        tabId: "tab-1",
        prompt: "old",
        layer: "composer-not-empty",
      },
      ctx,
    )) as { id: string }
    const oldAt = inbox.snapshot().find((item) => item.state === "prompt_deferred")?.at
    expect(oldAt).toEqual(expect.any(Number))
    const oldRecord = await store.get(old.id)
    if (!oldRecord) throw new Error("old deferred prompt missing")
    now = oldRecord.at + 24 * 60 * 60 * 1000 + 1

    const recordPromptDeferred = inbox.recordPromptDeferred.bind(inbox)
    let replacementStored = () => {}
    const stored = new Promise<void>((resolve) => {
      replacementStored = resolve
    })
    let finishPointer = () => {}
    const pointerGate = new Promise<void>((resolve) => {
      finishPointer = resolve
    })
    inbox.recordPromptDeferred = async (...args) => {
      replacementStored()
      await pointerGate
      await recordPromptDeferred(...args)
    }

    const filing = dispatch(
      "deferredPrompt.fileIfVacant",
      {
        taskId: TASK.id,
        tabId: "tab-1",
        prompt: "replacement",
        layer: "recent-human-write",
      },
      ctx,
    ) as Promise<{ id: string }>
    await stored
    await dispatch("attention.dismiss", { taskId: TASK.id, tabId: "tab-1", at: oldAt }, ctx)
    finishPointer()
    const replacement = await filing

    expect(replacement.id).not.toBe(old.id)
    expect((await store.get(replacement.id))?.prompt).toBe("replacement")
    const replacementRecord = await store.get(replacement.id)
    expect(inbox.snapshot()).toEqual([
      expect.objectContaining({
        detail: {
          // `expiresAt` rides the pointer so the Inbox row can show the
          // deadline the API half has always published.
          deferredPrompt: {
            id: replacement.id,
            layer: "recent-human-write",
            expiresAt: (replacementRecord?.at ?? 0) + 24 * 60 * 60 * 1000,
          },
        },
      }),
    ])
  })
})
