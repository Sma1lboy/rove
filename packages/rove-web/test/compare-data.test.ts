import { describe, expect, test } from "bun:test"
import type { DiffFileRow, TaskRow } from "rove-bridge/protocol"
import { attemptChanges, attemptsOf, replyExcerpt } from "../src/compare-data.ts"

const row = (id: string, groupId: string | undefined, createdAt: string): TaskRow =>
  ({ id, title: id, groupId, createdAt }) as unknown as TaskRow

const file = (
  path: string,
  scope: DiffFileRow["scope"],
  added: number | null,
  deleted: number | null,
): DiffFileRow => ({
  path,
  status: "M",
  added,
  deleted,
  scope,
})

describe("Compare page data", () => {
  test("a round's attempts are the rows of its group, oldest first", () => {
    const rows = [
      row("c", "g1", "2026-01-01T00:00:03Z"),
      row("x", "g2", "2026-01-01T00:00:00Z"),
      row("a", "g1", "2026-01-01T00:00:01Z"),
      row("lone", undefined, "2026-01-01T00:00:00Z"),
    ]
    expect(attemptsOf(rows, "g1").map((r) => r.id)).toEqual(["a", "c"])
    expect(attemptsOf(rows, "none")).toEqual([])
  })

  test("the excerpt is the newest assistant text, not a tool call or the user's prompt", () => {
    const text = (role: string, at: string, value: string) => ({
      role,
      timestamp: at,
      blocks: [{ type: "text", text: value }],
    })
    const reply = {
      history: {
        messages: [
          text("assistant", "2026-01-01T00:00:09Z", "final answer"),
          text("user", "2026-01-01T00:00:10Z", "the prompt"),
          { role: "assistant", timestamp: "2026-01-01T00:00:11Z", blocks: [{ type: "tool_call" }] },
          text("assistant", "2026-01-01T00:00:02Z", "first draft"),
        ],
      },
    }
    expect(replyExcerpt(reply)).toBe("final answer")
  })

  test("an engine without history shows the last non-blank terminal lines; nothing at all is null", () => {
    const tail = ["boot", "", "one", "two", "three", "four", "five", "six", "  "]
    expect(replyExcerpt({ terminal: { tail } })).toBe("one\ntwo\nthree\nfour\nfive\nsix")
    expect(replyExcerpt({ history: { messages: [] }, terminal: { tail: ["", " "] } })).toBeNull()
    expect(replyExcerpt({})).toBeNull()
  })

  test("a long reply is clipped with an ellipsis", () => {
    const long = "x".repeat(1000)
    const excerpt = replyExcerpt({
      history: { messages: [{ role: "assistant", blocks: [{ type: "text", text: long }] }] },
    })
    expect(excerpt?.length).toBe(401)
    expect(excerpt?.endsWith("…")).toBe(true)
  })

  test("uncommitted changes win while there are any; else the branch's own; counts treat unknown as zero", () => {
    const both = {
      base: "main",
      files: [file("a.ts", "working", 3, 1), file("b.ts", "working", null, null), file("c.ts", "branch", 9, 9)],
    }
    expect(attemptChanges(both)).toMatchObject({ scope: "working", added: 3, deleted: 1 })
    expect(attemptChanges(both).files.map((f) => f.path)).toEqual(["a.ts", "b.ts"])
    expect(attemptChanges({ base: "main", files: [file("c.ts", "branch", 9, 2)] })).toMatchObject({
      scope: "branch",
      added: 9,
      deleted: 2,
    })
    expect(attemptChanges({ base: null, files: [] })).toMatchObject({
      scope: "branch",
      files: [],
      added: 0,
      deleted: 0,
    })
  })
})
