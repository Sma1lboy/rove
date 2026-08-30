/**
 * Unit tests for the file tree's pure row model (`filetree/rows.ts`) —
 * the fix for the Ops pane's multi-GB memory growth.
 *
 * Why these matter: Solid's `<For>` keys by OBJECT IDENTITY, and
 * @opentui/core 0.2.4 retains native memory on every renderable
 * create/destroy cycle. The leak fix is therefore an identity contract,
 * invisible to a value-equality assertion: `reconcileRows` must return
 * the PREVIOUS object (===) for every row whose fields are unchanged,
 * and the previous ARRAY itself when nothing changed at all. These tests
 * pin that contract with toBe — if a refactor breaks identity reuse the
 * UI still looks identical, but the production leak silently returns.
 */

import { describe, expect, test } from "vitest"
import { displayWidth } from "../../src/lib/display-width.ts"
import {
  type Row,
  reconcileRows,
  sameFileList,
  sameStatusEntries,
  truncatePathTail,
} from "../../src/tui/panes/filetree/rows"

function file(path: string, depth = 0): Row {
  return { kind: "file", path, name: path.split("/").pop() ?? path, depth }
}
function dir(path: string, expanded: boolean): Row {
  return { kind: "dir", path, name: path, depth: 0, expanded, hasChildren: true }
}
function status(path: string, added = 1, deleted = 0): Row {
  return { kind: "status", path, status: "M", added, deleted }
}

describe("reconcileRows", () => {
  test("identical rebuild returns the PREVIOUS array itself (no downstream notify)", () => {
    const prev = [dir("src", true), file("src/a.ts", 1), file("src/b.ts", 1)]
    const next = [dir("src", true), file("src/a.ts", 1), file("src/b.ts", 1)]
    expect(reconcileRows(prev, next)).toBe(prev)
  })

  test("unchanged rows keep their previous object identity when one row changes", () => {
    const prev = [dir("src", true), file("src/a.ts", 1), file("src/b.ts", 1)]
    const next = [dir("src", true), file("src/a.ts", 1), file("src/c.ts", 1)]
    const out = reconcileRows(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[0]) // reused → <For> keeps its renderables
    expect(out[1]).toBe(prev[1])
    expect(out[2]).toBe(next[2]) // genuinely new row is the fresh object
  })

  test("a field change breaks reuse for that row only (dir collapse)", () => {
    const prev = [dir("src", true), file("src/a.ts", 1)]
    const next = [dir("src", false)] // collapsed: children gone, expanded flipped
    const out = reconcileRows(prev, next)
    expect(out[0]).toBe(next[0]) // expanded differs → fresh object
    expect(out).toHaveLength(1)
  })

  test("status rows reuse on equal diff stats, replace on changed stats", () => {
    const prev = [status("a.ts", 3, 1), status("b.ts", 0, 2)]
    const out = reconcileRows(prev, [status("a.ts", 3, 1), status("b.ts", 5, 2)])
    expect(out[0]).toBe(prev[0])
    expect(out[0]).not.toBe(undefined)
    expect(out[1]).not.toBe(prev[1])
  })

  test("reorder reuses objects but returns a new array (positions changed)", () => {
    const prev = [file("a.ts"), file("b.ts")]
    const next = [file("b.ts"), file("a.ts")]
    const out = reconcileRows(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[1])
    expect(out[1]).toBe(prev[0])
  })

  test("empty prev passes next through untouched", () => {
    const next = [file("a.ts")]
    expect(reconcileRows([], next)).toBe(next)
  })
})

describe("content-equality signal guards", () => {
  test("sameFileList: identical git ls-files output suppresses the signal", () => {
    expect(sameFileList(["a.ts", "b.ts"], ["a.ts", "b.ts"])).toBe(true)
    expect(sameFileList(["a.ts"], ["a.ts", "b.ts"])).toBe(false)
    expect(sameFileList(null, ["a.ts"])).toBe(false) // null = not loaded, only equal to itself
    expect(sameFileList(null, null)).toBe(true)
  })

  test("sameStatusEntries: equal status+numstat suppresses; any field change notifies", () => {
    const a = [{ path: "a.ts", status: "M" as const, added: 1, deleted: 0 }]
    expect(sameStatusEntries(a, [{ path: "a.ts", status: "M", added: 1, deleted: 0 }])).toBe(true)
    expect(sameStatusEntries(a, [{ path: "a.ts", status: "M", added: 2, deleted: 0 }])).toBe(false)
    expect(sameStatusEntries(a, null)).toBe(false)
  })
})

describe("truncatePathTail", () => {
  test("returns the path unchanged when it fits the budget", () => {
    expect(truncatePathTail("src/a.ts", 20)).toBe("src/a.ts")
    expect(truncatePathTail("src/a.ts", 8)).toBe("src/a.ts")
  })

  test("keeps the tail (leaf) and marks the elided prefix with a leading …", () => {
    expect(truncatePathTail("components/sidebar/Sidebar.tsx", 14)).toBe("…r/Sidebar.tsx")
  })

  test("never bisects a surrogate pair — emoji stay intact", () => {
    // Each 🎉 is one code point, two UTF-16 code units, and TWO CELLS. The
    // budget is cells: 8 less one for the `…` leaves 7, which buys `.ts` (3)
    // and two 🎉 (4). A third would need 9. Whatever the budget, the cut
    // lands on a character boundary — a `.slice` by .length would start
    // mid-emoji and emit a lone surrogate (→ the replacement glyph).
    expect(truncatePathTail("src/aaaaa-🎉🎉🎉.ts", 8)).toBe("…🎉🎉.ts")
  })

  test("spends the budget in CELLS, so a CJK path cannot overrun the pane", () => {
    // THE regression this owns. `文档/设计/终端渲染说明书笔记.md` is 18 code
    // points but 31 cells; a file pane 34 wide budgets 26. Counting code
    // points said "18 ≤ 26, fits" and drew 31 cells — five straight through
    // the pane border and into the workspace beside it.
    const path = "文档/设计/终端渲染说明书笔记.md"
    expect([...path].length).toBeLessThan(26) // why the code-point check passed
    expect(displayWidth(path)).toBe(31) // what it actually costs
    expect(displayWidth(truncatePathTail(path, 26))).toBeLessThanOrEqual(26)
    // The leaf survives; only the leading directories elide.
    expect(truncatePathTail(path, 26)).toContain(".md")
    expect(truncatePathTail(path, 26).startsWith("…")).toBe(true)
  })

  test("an ASCII path of the same code-point count is unaffected", () => {
    // The guard against a CJK-only fix: a 1-cell-per-glyph path spends
    // exactly what it did before, so the desktop layout is byte-identical.
    const ascii = "docs/design/terminal-rendering-notes.md"
    expect(truncatePathTail(ascii, 26)).toBe("…rminal-rendering-notes.md")
    expect(displayWidth(truncatePathTail(ascii, 26))).toBe(26)
  })

  test("max <= 0 leaves no room, so yields the empty string", () => {
    expect(truncatePathTail("a/b/c.ts", 0)).toBe("")
  })
})
