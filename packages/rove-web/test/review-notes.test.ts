import { describe, expect, test } from "bun:test"
import { noteTarget, parseUnifiedDiff, visibleIndexes } from "../src/diff.ts"
import { type Note, locate, noteState, quoteRows } from "../src/review-notes.ts"

const diff = (a: string, b: string): string =>
  [
    `diff --git a/${a} b/${a}`,
    "index 1..2 100644",
    `--- a/${a}`,
    `+++ b/${a}`,
    "@@ -1,2 +1,3 @@",
    " keep",
    "-old",
    "+new",
    "+extra",
    `diff --git a/${b} b/${b}`,
    "--- /dev/null",
    `+++ b/${b}`,
    "@@ -0,0 +1,1 @@",
    "+fresh",
  ].join("\n")

describe("review notes against the rows on screen", () => {
  const rows = parseUnifiedDiff(diff("src/a.ts", "src/b.ts"))
  const at = rows.findIndex((row) => row.text === "new")
  const note = (over: Partial<Note> = {}): Note => ({
    id: "n1",
    filePath: "src/a.ts",
    line: 2,
    startLine: 2,
    body: "why?",
    code: quoteRows(rows, at, at + 1),
    ...over,
  })

  test("a range quotes its rows with their diff signs and sits where it was written", () => {
    expect(quoteRows(rows, at, at + 1)).toBe("+new\n+extra")
    expect(locate(note({ line: 3 }), rows)).toEqual({ first: at, last: at + 1 })
  })

  test("a removed row and an added row sharing a gutter number are told apart by their code", () => {
    const removed = rows.findIndex((row) => row.text === "old")
    expect(rows[removed]?.oldNo).toBe(rows[at]?.newNo)
    expect(locate(note({ line: 2, startLine: undefined, code: "+new" }), rows)).toEqual({ first: at, last: at })
    expect(locate(note({ line: 2, startLine: undefined, code: "-old" }), rows)).toEqual({
      first: removed,
      last: removed,
    })
  })

  test("a note whose code changed is moved; a file this view doesn't hold says nothing", () => {
    const edited = parseUnifiedDiff(diff("src/a.ts", "src/b.ts").replace("+new", "+newer"))
    expect(noteState(note({ line: 3 }), rows, true)).toBe("ok")
    expect(noteState(note({ line: 3 }), edited, true)).toBe("moved")
    const onlyB = parseUnifiedDiff(diff("src/b.ts", "src/c.ts"))
    expect(noteState(note(), onlyB, false)).toBe("unknown")
    // The whole worktree no longer changes the file at all.
    expect(noteState(note(), onlyB, true)).toBe("moved")
  })

  test("a note without code (the TUI's) sits on its line numbers", () => {
    expect(locate({ id: "t", filePath: "src/b.ts", line: 1, body: "x" }, rows)).toEqual({
      first: rows.findIndex((row) => row.text === "fresh"),
      last: rows.findIndex((row) => row.text === "fresh"),
    })
  })

  test("a range across two files comments on the cursor's line only", () => {
    const fresh = rows.findIndex((row) => row.text === "fresh")
    expect(noteTarget(rows, fresh, at)).toMatchObject({ path: "src/b.ts", line: 1, first: fresh, last: fresh })
    expect(noteTarget(rows, at + 1, at)).toMatchObject({ startLine: 2, line: 3, first: at, last: at + 1 })
  })

  test("folding a file keeps its header and hides its rows", () => {
    const shown = visibleIndexes(rows, new Set(["src/a.ts"]))
    expect(shown.map((i) => rows[i]?.kind === "file")).toContain(true)
    expect(shown.some((i) => rows[i]?.text === "new")).toBe(false)
    expect(shown.some((i) => rows[i]?.text === "fresh")).toBe(true)
  })
})
