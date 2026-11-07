import { describe, expect, test } from "bun:test"
import { chatReference } from "../src/diff.ts"

describe("chatReference", () => {
  test("a range names its file as a mention and its lines in words", () => {
    expect(chatReference({ path: "src/a.ts", startLine: 12, line: 20 })).toBe("@src/a.ts (lines 12-20) ")
  })
  test("one line", () => {
    expect(chatReference({ path: "src/a.ts", line: 7 })).toBe("@src/a.ts (line 7) ")
  })
})
