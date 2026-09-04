import { describe, expect, it, vi } from "vitest"
import { notifyInboxRpcFailure } from "../../src/tui-react/workspace/inbox-rpc-errors.ts"

describe("notifyInboxRpcFailure", () => {
  it.each([
    ["mark read", new Error("daemon exploded"), "Couldn't mark it read — it stays in the inbox: daemon exploded"],
    ["dismiss", "socket closed", "Couldn't dismiss it — it stays in the inbox: socket closed"],
  ] as const)("turns a rejected %s request into a string error", async (action, failure, expected) => {
    const notifyError = vi.fn()

    notifyInboxRpcFailure(Promise.reject(failure), action, notifyError)
    await Promise.resolve()

    expect(notifyError).toHaveBeenCalledWith(expected)
  })
})
