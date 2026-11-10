import { describe, expect, test } from "bun:test"
import { PEEK_LINES, inboxBadge, tailOf } from "../src/inbox.ts"

describe("Inbox peek", () => {
  test("the tail drops row padding and blank rows at both ends, keeping blanks between text", () => {
    const tail = ["", "  ", "question?  ", "", "  1. yes", "   ", ""]
    expect(tailOf({ terminal: { tail } })).toEqual(["question?", "", "  1. yes"])
  })

  test("only the last lines show, and a reply with no terminal is empty", () => {
    const tail = Array.from({ length: 30 }, (_, i) => `line ${i}`)
    const lines = tailOf({ terminal: { tail } })
    expect(lines).toHaveLength(PEEK_LINES)
    expect(lines.at(-1)).toBe("line 29")
    expect(tailOf({})).toEqual([])
  })

  test("a decision gate reads as needing a decision, not as an error", () => {
    expect(inboxBadge("decision_needed").stateKey).toBe("inbox.state.decision")
  })
})
