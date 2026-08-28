import { describe, expect, it } from "vitest"
import { formatError } from "../src/lib/toast.ts"

/**
 * Every failed mutation (rename/archive/create/delete) routes through
 * reportError → formatError for its toast text. Lock the `label: cause` shape
 * so a thrown Error shows its message (not "[object Object]") and a non-Error
 * still produces readable text instead of swallowing the failure.
 */

describe("formatError", () => {
  it("uses an Error's message as the cause", () => {
    expect(formatError("Rename failed", new Error("boom"))).toBe(
      "Rename failed: boom",
    )
  })

  it("stringifies a thrown string", () => {
    expect(formatError("Archive failed", "nope")).toBe("Archive failed: nope")
  })

  it("renders a plain object as JSON, never [object Object]", () => {
    expect(formatError("Create failed", { code: 500 })).toBe(
      'Create failed: {"code":500}',
    )
  })

  it("keeps an object's own toString when it has a real one", () => {
    const err = { toString: () => "custom cause" }
    expect(formatError("X", err)).toBe("X: custom cause")
  })

  it("survives a circular object without throwing", () => {
    const err: Record<string, unknown> = {}
    err.self = err
    expect(formatError("X", err)).toBe("X: [object Object]")
  })

  it("handles null/undefined causes without throwing", () => {
    expect(formatError("X", null)).toBe("X: null")
    expect(formatError("X", undefined)).toBe("X: undefined")
  })

  it("preserves a subclassed Error's message", () => {
    class RpcError extends Error {}
    expect(formatError("rpc", new RpcError("timeout"))).toBe("rpc: timeout")
  })
})
