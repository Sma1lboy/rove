import { describe, expect, it } from "vitest"
import { resolveHarnessRenderer } from "../src/lib/harness-renderer.ts"

describe("harness renderer policy", () => {
  it("uses the automatic WebGL or Canvas path by default", () => {
    expect(resolveHarnessRenderer(new URLSearchParams())).toBe("automatic")
    expect(resolveHarnessRenderer(new URLSearchParams("wallpaper=/capture-wallpaper.svg"))).toBe("automatic")
  })

  it("keeps DOM rendering behind an explicit diagnostic query", () => {
    expect(resolveHarnessRenderer(new URLSearchParams("renderer=dom"))).toBe("dom")
    expect(resolveHarnessRenderer(new URLSearchParams("renderer=webgl"))).toBe("automatic")
  })
})
