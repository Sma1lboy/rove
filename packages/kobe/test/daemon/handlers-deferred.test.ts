import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { DeferredPromptsStore as Store } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
import { afterEach, describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

describe("deferredPrompt RPC handlers (issue #78 B)", () => {
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

  it("get reads a record back by id (null once resolved)", async () => {
    const { ctx, store } = await ctxWithStore()
    const { id } = (await dispatch(
      "deferredPrompt.file",
      { taskId: TASK.id, tabId: "tab-1", prompt: "queued", layer: "recent-human-write" },
      ctx,
    )) as { id: string }

    const got = (await dispatch("deferredPrompt.get", { id }, ctx)) as { record: { prompt: string } | null }
    expect(got.record?.prompt).toBe("queued")

    await dispatch("deferredPrompt.resolve", { id }, ctx)
    const after = (await dispatch("deferredPrompt.get", { id }, ctx)) as { record: unknown }
    expect(after.record).toBeNull()
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
})
