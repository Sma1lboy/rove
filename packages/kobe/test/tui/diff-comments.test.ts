import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, test } from "vitest"
import {
  type DiffComment,
  buildDiffReview,
  commentAtRow,
  commentRange,
  computeReviewPaint,
  diffCommentsKey,
  formatDiffComment,
  formatDiffComments,
  markAllSent,
  unifiedDiffRows,
  unsentComments,
} from "../../src/tui/ops/diff-comments"

function comment(over: Partial<DiffComment>): DiffComment {
  return { id: "c1", filePath: "a.ts", line: 1, body: "note", createdAt: 1, ...over }
}

describe("formatDiffComment", () => {
  it("renders File / Line / quoted comment", () => {
    expect(formatDiffComment(comment({ filePath: "src/a.ts", line: 12, body: "rename this" }))).toBe(
      'File: src/a.ts\nLine: 12\nUser comment: "rename this"',
    )
  })

  it("renders a range as Lines: start-end", () => {
    expect(formatDiffComment(comment({ line: 14, startLine: 12 }))).toContain("Lines: 12-14")
  })

  it("treats startLine === line as a single line", () => {
    expect(formatDiffComment(comment({ line: 5, startLine: 5 }))).toContain("Line: 5")
  })

  it("escapes backslashes, quotes, and newlines (orca contract)", () => {
    const out = formatDiffComment(comment({ body: 'a\\b "quoted"\r\nnext' }))
    expect(out).toContain('User comment: "a\\\\b \\"quoted\\"\\r\\nnext"')
  })

  it("joins multiple comments with a blank line", () => {
    const out = formatDiffComments([comment({ line: 1 }), comment({ line: 2 })])
    expect(out.split("\n\n")).toHaveLength(2)
  })
})

const SAMPLE_DIFF = [
  "diff --git a/a.ts b/a.ts",
  "index 1111111..2222222 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1",
  "-const b = 2",
  "+const b = 3",
  "+const c = 4",
  " const d = 5",
  "@@ -10,2 +11,2 @@",
  " x",
  "-y",
  "+z",
  "\\ No newline at end of file",
  "",
].join("\n")

describe("unifiedDiffRows", () => {
  it("mirrors opentui's unified row order with display line numbers", () => {
    expect(unifiedDiffRows(SAMPLE_DIFF)).toEqual([
      { kind: "ctx", line: 1 },
      { kind: "del", line: 2 },
      { kind: "add", line: 2 },
      { kind: "add", line: 3 },
      { kind: "ctx", line: 4 },
      { kind: "ctx", line: 11 },
      { kind: "del", line: 11 },
      { kind: "add", line: 12 },
    ])
  })

  it("returns no rows for non-diff text", () => {
    expect(unifiedDiffRows("just some file contents\nno hunks here")).toEqual([])
  })
})

describe("commentRange", () => {
  const rows = unifiedDiffRows(SAMPLE_DIFF)

  it("is a single line without an anchor", () => {
    expect(commentRange(rows, 3, null)).toEqual({ line: 3 })
  })

  it("spans anchor..cursor in either direction", () => {
    expect(commentRange(rows, 4, 2)).toEqual({ line: 4, startLine: 2 })
    expect(commentRange(rows, 2, 4)).toEqual({ line: 4, startLine: 2 })
  })

  it("collapses a non-monotonic range to the cursor line", () => {
    // rows 1 (del old:2) → 2 (add new:2): display lines don't order.
    expect(commentRange(rows, 2, 1)).toEqual({ line: 2 })
  })

  it("returns null when the cursor is out of range", () => {
    expect(commentRange(rows, 99, null)).toBeNull()
  })
})

describe("computeReviewPaint", () => {
  const rows = unifiedDiffRows(SAMPLE_DIFF)

  it("marks the cursor row", () => {
    const paint = computeReviewPaint(rows, 0, null, [], "a.ts")
    expect(paint.get(0)).toBe("cursor")
    expect(paint.size).toBe(1)
  })

  it("marks the anchor..cursor range with the cursor winning", () => {
    const paint = computeReviewPaint(rows, 3, 1, [], "a.ts")
    expect(paint.get(1)).toBe("range")
    expect(paint.get(2)).toBe("range")
    expect(paint.get(3)).toBe("cursor")
  })

  it("marks rows covered by UNSENT comments on this file only", () => {
    const comments = [
      comment({ line: 3, startLine: 2 }),
      comment({ id: "c2", line: 4, sentAt: 99 }),
      comment({ id: "c3", filePath: "other.ts", line: 1 }),
    ]
    const paint = computeReviewPaint(rows, 0, null, comments, "a.ts")
    // display lines 2..3 → rows 1 (del old:2), 2 (add new:2), 3 (add new:3)
    expect(paint.get(1)).toBe("note")
    expect(paint.get(2)).toBe("note")
    expect(paint.get(3)).toBe("note")
    expect(paint.get(4)).toBeUndefined() // sent comment (line 4) not painted
    expect(paint.get(0)).toBe("cursor")
  })
})

describe("sent bookkeeping", () => {
  it("unsentComments / markAllSent round-trip", () => {
    const list = [comment({ id: "a" }), comment({ id: "b", sentAt: 5 })]
    expect(unsentComments(list).map((c) => c.id)).toEqual(["a"])
    const sent = markAllSent(list, 42)
    expect(sent.map((c) => c.sentAt)).toEqual([42, 5])
    expect(unsentComments(sent)).toEqual([])
  })
})

describe("commentAtRow", () => {
  const rows = unifiedDiffRows(["@@ -1,2 +1,3 @@", " a", "+b", "+c"].join("\n"))
  const notes: DiffComment[] = [
    { id: "n1", filePath: "a.ts", line: 3, startLine: 2, body: "range", createdAt: 1 },
    { id: "n2", filePath: "b.ts", line: 2, body: "other file", createdAt: 2 },
  ]

  it("finds the note whose range covers the cursor row's display line", () => {
    expect(commentAtRow(rows, 1, notes, "a.ts")?.id).toBe("n1")
    expect(commentAtRow(rows, 2, notes, "a.ts")?.id).toBe("n1")
  })

  it("ignores notes on another file and rows outside every range", () => {
    // n2 sits on b.ts at the same display line, so this is the assertion that
    // the file path is part of the match rather than incidental.
    expect(commentAtRow(rows, 1, notes, "c.ts")).toBeUndefined()
    expect(commentAtRow(rows, 1, notes, "b.ts")?.id).toBe("n2")
    expect(commentAtRow(rows, 0, notes, "a.ts")).toBeUndefined()
    expect(commentAtRow(rows, 99, notes, "a.ts")).toBeUndefined()
  })

  it("prefers the newest note when two cover the same line", () => {
    const overlapping: DiffComment[] = [
      ...notes,
      { id: "n3", filePath: "a.ts", line: 3, startLine: 2, body: "newer", createdAt: 3 },
    ]
    expect(commentAtRow(rows, 1, overlapping, "a.ts")?.id).toBe("n3")
  })
})

describe("buildDiffReview", () => {
  function fakeKv(): {
    store: Map<string, unknown>
    get: (k: string, d?: unknown) => unknown
    set: (k: string, v: unknown) => void
  } {
    const store = new Map<string, unknown>()
    return {
      store,
      get: (k, d) => store.get(k) ?? d,
      set: (k, v) => store.set(k, v),
    }
  }

  it("adds notes with generated id/createdAt under the task key", () => {
    const kv = fakeKv()
    const review = buildDiffReview(kv, "t1", () => true)
    review.add({ filePath: "a.ts", line: 3, body: "note one" })
    review.add({ filePath: "a.ts", line: 5, startLine: 4, body: "note two" })
    const stored = kv.store.get(diffCommentsKey("t1")) as DiffComment[]
    expect(stored).toHaveLength(2)
    expect(stored[0]?.id).toBeTruthy()
    expect(stored[0]?.createdAt).toBeGreaterThan(0)
    expect(stored[1]?.startLine).toBe(4)
  })

  it("send() batches ALL unsent notes into one prompt and marks them sent", () => {
    const kv = fakeKv()
    const sends: string[] = []
    const review = buildDiffReview(kv, "t1", (text) => {
      sends.push(text)
      return true
    })
    review.add({ filePath: "a.ts", line: 3, body: "first" })
    review.add({ filePath: "b.ts", line: 7, body: "second" })
    review.send()
    expect(sends).toHaveLength(1)
    expect(sends[0]).toContain("File: a.ts")
    expect(sends[0]).toContain("File: b.ts")
    expect(sends[0]).toContain('User comment: "first"')
    const stored = kv.store.get(diffCommentsKey("t1")) as DiffComment[]
    expect(stored.every((c) => c.sentAt !== undefined)).toBe(true)
    // A second send with nothing unsent is a no-op.
    review.send()
    expect(sends).toHaveLength(1)
  })

  it("keeps the notes unsent when the engine send is refused", () => {
    // The whole point of the guard: `s` on a task with no engine session used
    // to mark everything sent, so the footer read `0 unsent` and the batch was
    // indistinguishable from a delivered one — forever.
    const kv = fakeKv()
    const review = buildDiffReview(kv, "t1", () => false)
    review.add({ filePath: "a.ts", line: 3, body: "keep me" })
    expect(review.send()).toBe(false)
    const stored = kv.store.get(diffCommentsKey("t1")) as DiffComment[]
    expect(unsentComments(stored)).toHaveLength(1)
    // And a later send that DOES reach an engine still delivers it.
    const sends: string[] = []
    const live = buildDiffReview(kv, "t1", (text) => {
      sends.push(text)
      return true
    })
    expect(live.send()).toBe(true)
    expect(sends[0]).toContain('User comment: "keep me"')
  })

  it("nothing to send is not a failure", () => {
    const kv = fakeKv()
    expect(buildDiffReview(kv, "t1", () => false).send()).toBe(true)
  })

  it("remove() drops one note and leaves the rest", () => {
    const kv = fakeKv()
    const review = buildDiffReview(kv, "t1", () => true)
    review.add({ filePath: "a.ts", line: 3, body: "typo" })
    review.add({ filePath: "a.ts", line: 9, body: "keep" })
    const stored = kv.store.get(diffCommentsKey("t1")) as DiffComment[]
    buildDiffReview(kv, "t1", () => true).remove(stored[0]?.id ?? "")
    const after = kv.store.get(diffCommentsKey("t1")) as DiffComment[]
    expect(after.map((c) => c.body)).toEqual(["keep"])
  })
})

describe("stale paths in the sent prompt", () => {
  // The anchoring ceiling keeps a note on the path it was written against
  // forever. When the branch renames or deletes that file, the prompt named a
  // path the agent cannot open and said nothing about why.
  const note = { filePath: "src/parser.js", line: 2, body: "use String() not trim" }
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kobe-notes-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test("marks a note whose path the branch no longer has", () => {
    const out = formatDiffComments([note], root)
    expect(out).toContain("File: src/parser.js")
    expect(out).toContain("no longer in the branch")
  })

  test("says nothing about a path that is still there", () => {
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src", "parser.js"), "x\n")
    expect(formatDiffComments([note], root)).not.toContain("no longer in the branch")
  })

  test("with no worktree to check against, marks nothing", () => {
    expect(formatDiffComments([note])).not.toContain("no longer in the branch")
  })
})
