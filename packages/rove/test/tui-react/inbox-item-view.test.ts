import { describe, expect, it } from "vitest"
import { reportMissingNote } from "../../src/tui-react/workspace/inbox-item-view"

describe("reportMissingNote", () => {
  const delivery = { id: "d-1", cause: "turn-failed" as const }

  it("surfaces the daemon's note on a report_missing episode only", () => {
    expect(reportMissingNote({ state: "report_missing", detail: { delivery, note: "  quota hit \n" } })).toBe(
      "quota hit",
    )
    expect(reportMissingNote({ state: "error", detail: { note: "boom" } })).toBeNull()
  })

  it("is null without a usable note", () => {
    expect(reportMissingNote({ state: "report_missing", detail: { delivery } })).toBeNull()
    expect(reportMissingNote({ state: "report_missing", detail: { delivery, note: "   " } })).toBeNull()
  })
})
