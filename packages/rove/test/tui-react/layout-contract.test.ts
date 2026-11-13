import { describe, expect, it } from "vitest"
import { dividerRule } from "../../src/tui-react/lib/rule-divider.ts"

describe("dividerRule", () => {
  it("always covers at least the terminal width", () => {
    expect(dividerRule(300)).toBe("─".repeat(300))
    expect(dividerRule(80)).toBe("─".repeat(80))
    expect(dividerRule(0)).toBe("─")
  })
})
