import { describe, expect, it } from "vitest"
import { MESSAGE_PREVIEW_MAX_CHARS, normalizeMessagePreview } from "../../src/lib/message-preview"

describe("normalizeMessagePreview", () => {
  it("collapses whitespace and bounds Unicode by character", () => {
    const preview = normalizeMessagePreview(`  first\nmessage  ${"🦊".repeat(200)}  `)

    expect(preview?.startsWith("first message ")).toBe(true)
    expect([...(preview ?? "")]).toHaveLength(MESSAGE_PREVIEW_MAX_CHARS)
  })

  it("drops empty and non-string values", () => {
    expect(normalizeMessagePreview(" \n ")).toBeUndefined()
    expect(normalizeMessagePreview(null)).toBeUndefined()
  })
})
