import { describe, expect, it } from "vitest"
import { coerceVendorId, isBuiltinVendor, nextVendorWithin, resolvePersistedVendor } from "../../src/types/vendor.ts"

describe("nextVendorWithin", () => {
  it("cycles within a subset, wrapping around", () => {
    const set = ["claude", "copilot"] as const
    expect(nextVendorWithin(set, "claude")).toBe("copilot")
    expect(nextVendorWithin(set, "copilot")).toBe("claude")
  })

  it("starts from the first entry when current is not in the subset", () => {
    // codex was filtered out (not detected); cycling from it lands on the first.
    expect(nextVendorWithin(["claude", "copilot"], "codex")).toBe("claude")
  })

  it("returns current unchanged for an empty subset (nothing detected)", () => {
    expect(nextVendorWithin([], "codex")).toBe("codex")
  })
})

describe("isBuiltinVendor", () => {
  it("is true for first-party engines and false for custom ones", () => {
    expect(isBuiltinVendor("claude")).toBe(true)
    expect(isBuiltinVendor("codex")).toBe(true)
    expect(isBuiltinVendor("copilot")).toBe(true)
    expect(isBuiltinVendor("kimi")).toBe(true)
    expect(isBuiltinVendor("pi")).toBe(true)
    expect(isBuiltinVendor("omp")).toBe(true)
    expect(isBuiltinVendor("aider")).toBe(false)
    expect(isBuiltinVendor(undefined)).toBe(false)
  })
})

describe("coerceVendorId", () => {
  it("falls back to claude only for empty/absent", () => {
    expect(coerceVendorId(undefined)).toBe("claude")
    expect(coerceVendorId("")).toBe("claude")
    expect(coerceVendorId("   ")).toBe("claude")
  })
})

describe("resolvePersistedVendor", () => {
  it("passes a registered custom engine id through", () => {
    expect(resolvePersistedVendor("aider", ["aider"])).toBe("aider")
    expect(resolvePersistedVendor("  my-engine ", ["my-engine"])).toBe("my-engine")
  })

  it("falls back to claude for an unregistered / typo'd value", () => {
    // garbage that is neither a built-in nor a known custom id
    expect(resolvePersistedVendor("clade")).toBe("claude")
    expect(resolvePersistedVendor("aider")).toBe("claude") // not in the (empty) custom registry
    expect(resolvePersistedVendor("aider", ["other-engine"])).toBe("claude")
  })
})
