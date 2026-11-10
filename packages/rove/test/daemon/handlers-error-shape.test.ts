import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
  shapeDaemonError,
} from "@sma1lboy/rove-daemon/daemon/server"
import { describe, expect, it } from "vitest"
import { fakeCtx } from "./handler-test-context.ts"

/**
 * Error-shaping wire-contract tests, moved VERBATIM out of
 * `handlers.test.ts` (file-size cap) — same pins, same wording guarantees.
 */

function dispatch(name: string, payload: unknown, ctx: DaemonHandlerContext): Promise<unknown> {
  return dispatchDaemonRequest(createDaemonHandlerRegistry(), name, payload, ctx)
}

describe("error shaping (one place decides the wire error)", () => {
  it("an unknown request keeps the legacy message", async () => {
    const { ctx } = fakeCtx()
    // e.g. a v2 client's removed `daemon.web.start` must still get this.
    await expect(dispatch("daemon.web.start", {}, ctx)).rejects.toThrow("unknown daemon request: daemon.web.start")
  })

  it("shapeDaemonError matches the historical on-the-wire shape exactly", () => {
    // Error instance → message + name ("Error" serializes onto the wire).
    expect(shapeDaemonError(new Error("boom"))).toEqual({ message: "boom", name: "Error" })
    const typed = new TypeError("bad type")
    expect(shapeDaemonError(typed)).toEqual({ message: "bad type", name: "TypeError" })
    // Non-Error throw → String() coercion, name undefined (dropped by
    // JSON.stringify, so the key never appears on the wire — pinned here).
    const shaped = shapeDaemonError("plain string")
    expect(shaped).toEqual({ message: "plain string", name: undefined })
    expect(JSON.stringify(shaped)).toBe('{"message":"plain string"}')
  })
})

describe("a stopped multi-repo land", () => {
  it("fails the request, carrying each repo's status as the wire error's data", async () => {
    const repos = [
      { name: "web", status: "landed" },
      { name: "api", status: "conflict", code: "LAND_CONFLICT" },
    ]
    const stopped = { repo: "api", code: "LAND_CONFLICT", message: "merging 'b' hit conflicts — conflicted files: x" }
    const { ctx } = fakeCtx({
      landTask: async () => ({ branch: "b", strategy: "merge", landedOn: "main", commit: "c", repos, stopped }),
    })

    const failure = await dispatch("task.land", { taskId: "t1" }, ctx).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(Error)
    expect(shapeDaemonError(failure)).toEqual({
      message: "LAND_CONFLICT: merging 'b' hit conflicts — conflicted files: x",
      name: "LandStoppedError",
      data: { stopped, repos },
    })
  })
})
