import { describe, expect, it } from "vitest"
import { argvHasFlag, flagValue } from "../../src/cli/argv.ts"

describe("flagValue", () => {
  it("reads both forms, prefix-safe, and distinguishes absent from empty", () => {
    expect(flagValue(["web", "--port", "5399"], "--port")).toBe("5399")
    expect(flagValue(["web", "--port=5399"], "--port")).toBe("5399")
    expect(flagValue(["web", "--port="], "--port")).toBe("")
    expect(flagValue(["web", "--port-x=1"], "--port")).toBeUndefined()
    expect(flagValue(["web", "--port"], "--port")).toBeUndefined()
    expect(argvHasFlag(["web", "--port"], "--port")).toBe(true)
  })
})
