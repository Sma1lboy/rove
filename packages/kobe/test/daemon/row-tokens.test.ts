/**
 * Row-token store + its RPC. The load-bearing property is the TTL: a token
 * must EXPIRE on its own, and the store must republish when it does, or a
 * plugin that dies leaves its labels on the user's screen forever.
 */

import type { DaemonRequestName } from "@sma1lboy/kobe-daemon/daemon/protocol"
import {
  ROW_TOKEN_DEFAULT_TTL_MS,
  ROW_TOKEN_MAX_PER_SOURCE,
  ROW_TOKEN_MAX_TEXT,
  ROW_TOKEN_MAX_TTL_MS,
  ROW_TOKEN_MIN_TTL_MS,
  type RowTokenMap,
  RowTokenStore,
  clampRowTokenTtl,
  normalizeRowTokenText,
} from "@sma1lboy/kobe-daemon/daemon/row-tokens"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
} from "@sma1lboy/kobe-daemon/daemon/server"
import { describe, expect, it } from "vitest"
import { fakeCtx } from "./handler-test-context.ts"

function dispatch(name: DaemonRequestName, payload: unknown, ctx: DaemonHandlerContext): Promise<unknown> {
  return dispatchDaemonRequest(createDaemonHandlerRegistry(), name, payload, ctx)
}

/** A store on a fake clock the test drives, plus every payload it published. */
function harness(startAt = 1_000_000) {
  let now = startAt
  const published: RowTokenMap[] = []
  const store = new RowTokenStore(
    { publish: (_channel: string, payload: unknown) => published.push((payload as { tokens: RowTokenMap }).tokens) },
    () => now,
  )
  const advance = (ms: number): void => {
    now += ms
  }
  return { store, published, advance, at: () => now }
}

describe("row-token clamps", () => {
  it("clamps a TTL into the documented window and defaults a missing one", () => {
    expect(clampRowTokenTtl(undefined)).toBe(ROW_TOKEN_DEFAULT_TTL_MS)
    expect(clampRowTokenTtl(Number.NaN)).toBe(ROW_TOKEN_DEFAULT_TTL_MS)
    expect(clampRowTokenTtl(0)).toBe(ROW_TOKEN_MIN_TTL_MS)
    expect(clampRowTokenTtl(-5)).toBe(ROW_TOKEN_MIN_TTL_MS)
    expect(clampRowTokenTtl(Number.POSITIVE_INFINITY)).toBe(ROW_TOKEN_DEFAULT_TTL_MS)
    expect(clampRowTokenTtl(999_999_999)).toBe(ROW_TOKEN_MAX_TTL_MS)
    expect(clampRowTokenTtl(5_000)).toBe(5_000)
  })

  it("collapses whitespace and trims to the row's budget", () => {
    expect(normalizeRowTokenText("  a\n\tb  ")).toBe("a b")
    expect(normalizeRowTokenText("x".repeat(80))).toHaveLength(ROW_TOKEN_MAX_TEXT)
  })
})

describe("RowTokenStore", () => {
  it("drops a token the moment its TTL passes, without another write", () => {
    const { store, advance } = harness()
    store.set({ taskId: "t1", source: "p", key: "k", text: "@ana", ttlMs: 5_000 })
    advance(4_999)
    expect(store.snapshot().t1).toHaveLength(1)
    advance(1)
    expect(store.snapshot()).toEqual({})
  })

  it("republishes at the expiry so a fading label needs no writer", async () => {
    // Real timers here on purpose: the republish IS a timer, and a fake clock
    // would prove only that the arithmetic is right, not that anything fires.
    const published: RowTokenMap[] = []
    const store = new RowTokenStore({
      publish: (_channel: string, payload: unknown) => published.push((payload as { tokens: RowTokenMap }).tokens),
    })
    store.set({ taskId: "t1", source: "p", key: "k", text: "@ana", ttlMs: ROW_TOKEN_MIN_TTL_MS })
    expect(published).toHaveLength(1)
    await new Promise((r) => setTimeout(r, ROW_TOKEN_MIN_TTL_MS + 150))
    expect(published.length).toBeGreaterThanOrEqual(2)
    expect(published.at(-1)).toEqual({})
    store.close()
  })

  it("replaces the same key rather than stacking copies — that is how a refresh works", () => {
    const { store, advance } = harness()
    store.set({ taskId: "t1", source: "p", key: "claim", text: "@ana", ttlMs: 10_000 })
    advance(9_000)
    store.set({ taskId: "t1", source: "p", key: "claim", text: "@ana", ttlMs: 10_000 })
    advance(2_000)
    // The first deadline has passed; the refresh carried the label through it.
    expect(store.snapshot().t1).toHaveLength(1)
  })

  it("caps a single plugin's slots, evicting the label it stopped refreshing", () => {
    const { store } = harness()
    for (const [i, key] of ["a", "b", "c"].entries()) {
      store.set({ taskId: "t1", source: "p", key, text: key, ttlMs: 10_000 + i * 1_000 })
    }
    const live = store.snapshot().t1 ?? []
    expect(live).toHaveLength(ROW_TOKEN_MAX_PER_SOURCE)
    // "a" had the nearest deadline — the one whose writer had gone quiet longest.
    expect(live.map((t) => t.key).sort()).toEqual(["b", "c"])
  })

  it("does not let one plugin's quota evict another's label", () => {
    const { store } = harness()
    store.set({ taskId: "t1", source: "other", key: "k", text: "theirs" })
    for (const key of ["a", "b", "c"]) store.set({ taskId: "t1", source: "p", key, text: key })
    expect((store.snapshot().t1 ?? []).some((t) => t.source === "other")).toBe(true)
  })

  it("clears one key, or every token of one source", () => {
    const { store } = harness()
    store.set({ taskId: "t1", source: "p", key: "a", text: "a" })
    store.set({ taskId: "t1", source: "p", key: "b", text: "b" })
    expect(store.clear("t1", "p", "a")).toBe(true)
    expect((store.snapshot().t1 ?? []).map((t) => t.key)).toEqual(["b"])
    expect(store.clear("t1", "p")).toBe(true)
    expect(store.snapshot()).toEqual({})
  })

  it("drops a deleted task's whole row", () => {
    const { store, published } = harness()
    store.set({ taskId: "t1", source: "p", key: "a", text: "a" })
    store.clearTask("t1")
    expect(published.at(-1)).toEqual({})
  })
})

describe("task.rowToken RPC", () => {
  it("writes a token with the caller's source and returns it", async () => {
    const { ctx, rec } = fakeCtx()
    const result = (await dispatch(
      "task.rowToken",
      { taskId: "t1", source: "examples.row-tokens", key: "claim", text: "@ana", tone: "info", ttlMs: 5_000 },
      ctx,
    )) as { ok: boolean; token: { source: string; text: string; tone?: string } }
    expect(result.ok).toBe(true)
    expect(result.token).toMatchObject({ source: "examples.row-tokens", text: "@ana", tone: "info" })
    expect(rec.published.some((p) => p.channel === "task.tokens")).toBe(true)
  })

  it("ignores a tone that is not one of ours instead of passing a colour through", async () => {
    const { ctx } = fakeCtx()
    const result = (await dispatch("task.rowToken", { taskId: "t1", text: "x", tone: "#ff0000" }, ctx)) as {
      token: { tone?: string }
    }
    expect(result.token.tone).toBeUndefined()
  })

  it("defaults an unattributed write to the cli source", async () => {
    const { ctx } = fakeCtx()
    const result = (await dispatch("task.rowToken", { taskId: "t1", text: "x" }, ctx)) as {
      token: { source: string; key: string }
    }
    expect(result.token).toMatchObject({ source: "cli", key: "default" })
  })

  it("requires text on a write", async () => {
    const { ctx } = fakeCtx()
    await expect(dispatch("task.rowToken", { taskId: "t1" }, ctx)).rejects.toThrow("text is required")
  })

  it("answers UNSUPPORTED on a host with no row-token store", async () => {
    const { ctx } = fakeCtx()
    const older = { ...ctx, rowTokens: undefined }
    await expect(dispatch("task.rowToken", { taskId: "t1", text: "x" }, older)).resolves.toEqual({
      ok: false,
      reason: "UNSUPPORTED",
    })
  })
})
