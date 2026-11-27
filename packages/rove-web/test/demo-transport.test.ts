import { describe, expect, test } from "bun:test"
import { answer } from "../src/demo/transport.ts"

describe("the iPhone demo's bridge", () => {
  test("picks an entry by its arguments, falling back to the default", () => {
    expect(answer("sessions.search", { query: "nothing" })).toEqual({ matches: [], skipped: [], truncated: false })
    const hits = answer("sessions.search", { query: "refund" }) as { matches: { at: string }[] }
    expect(hits.matches.length).toBeGreaterThan(0)
  })
  test("dates are relative to now", () => {
    const now = Date.parse("2026-11-27T12:00:00Z")
    const hits = answer("sessions.search", { query: "x" }, now) as { matches: { at: string }[] }
    expect(hits.matches[0]?.at).toBe("2026-11-27T11:48:00.000Z")
  })
  test("a setting reads back changed; an unknown op answers empty", () => {
    answer("prefs.set", { key: "theme", value: "nord" })
    expect((answer("prefs.get") as { prefs: { theme: string } }).prefs.theme).toBe("nord")
    expect(answer("no.such.op")).toEqual({})
  })
})
