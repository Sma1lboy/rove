/**
 * A verb whose daemon RPC does not exist is a VERSION SKEW, not a failed call.
 *
 * The incident: `rove api schema --verb archive` printed a full spec and
 * exited 0, then `rove api archive --task-id …` came back
 * `{"error":{"message":"unknown daemon request: task.archive","code":"RPC_ERROR"}}`
 * 200ms later — the CLI was an older build than the daemon that had dropped
 * the verb. Schema is how an agent DISCOVERS a capability, so the rejection
 * has to say "these two builds disagree", not "the call failed".
 */

import { describe, expect, it } from "vitest"
import { ApiError, invokeVerb, toApiError } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

describe("unknown daemon request", () => {
  it("types the daemon's unknown-request rejection as a version skew, with the restart command", async () => {
    // The daemon's own wording (daemon/handlers.ts) — matched verbatim so a
    // reworded daemon error can't silently fall back to bare RPC_ERROR.
    const client = new FakeClient({
      "task.setActive": () => {
        throw new Error("unknown daemon request: task.setActive")
      },
    })
    try {
      await invokeVerb("set-active", ["--task-id", "t1"], { client, runtime: stubRuntime() })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      const err = error as ApiError
      expect(err.code).toBe("DAEMON_VERSION_SKEW")
      // The hint must say what the CALLER does, not just that versions differ.
      expect(err.data?.hint).toMatch(/restart the daemon/i)
      expect(err.data?.nextCommandArgs).toEqual(["daemon", "restart"])
      // The daemon's message survives so the caller can see WHICH verb.
      expect(err.message).toContain("task.setActive")
    }
  })

  it("covers both skew directions — old CLI × new daemon is the same rejection", () => {
    // The removed-verb case from the incident: this CLI still ships `archive`,
    // the newer daemon does not serve `task.archive`. Identical wire error, so
    // one branch has to answer both directions.
    const err = toApiError(new Error("unknown daemon request: task.archive"))
    expect(err.code).toBe("DAEMON_VERSION_SKEW")
    expect(err.data?.nextCommandArgs).toEqual(["daemon", "restart"])
  })

  it("leaves an ordinary handler failure as RPC_ERROR", async () => {
    // The branch must not swallow every RPC failure — an unrelated daemon
    // error is still the untyped fall-through.
    const client = new FakeClient({
      "task.setActive": () => {
        throw new Error("disk is full")
      },
    })
    await expectApiError(
      () => invokeVerb("set-active", ["--task-id", "t1"], { client, runtime: stubRuntime() }),
      "RPC_ERROR",
      /disk is full/,
    )
  })
})
