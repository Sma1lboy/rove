import { describe, expect, test } from "bun:test"
import { fileHashes, nextAfter, viewedFiles, withMark } from "../src/diff-viewed.ts"
import { parseUnifiedDiff } from "../src/diff.ts"

const patch = (a: string, b: string) =>
  [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,1 +1,1 @@",
    `-${a}`,
    `+${b}`,
    "diff --git a/b.ts b/b.ts",
    "--- a/b.ts",
    "+++ b/b.ts",
    "@@ -1,1 +1,1 @@",
    "-x",
    "+y",
  ].join("\n")

describe("viewed marks", () => {
  test("a mark holds until that file's diff changes, and only that file's", () => {
    const first = fileHashes(parseUnifiedDiff(patch("one", "two")))
    let marks = withMark({}, "T1", "a.ts", first.get("a.ts"))
    marks = withMark(marks, "T1", "b.ts", first.get("b.ts"))
    expect([...viewedFiles(marks, "T1", first)].sort()).toEqual(["a.ts", "b.ts"])

    const edited = fileHashes(parseUnifiedDiff(patch("one", "three")))
    expect([...viewedFiles(marks, "T1", edited)]).toEqual(["b.ts"])
  })

  test("marks are per task and can be cleared", () => {
    const hashes = fileHashes(parseUnifiedDiff(patch("one", "two")))
    const marks = withMark({}, "T1", "a.ts", hashes.get("a.ts"))
    expect(viewedFiles(marks, "T2", hashes).size).toBe(0)
    expect(viewedFiles(withMark(marks, "T1", "a.ts", undefined), "T1", hashes).size).toBe(0)
  })
})

describe("nextAfter", () => {
  test("steps forward and wraps", () => {
    expect(nextAfter([2, 5, 9], 2)).toBe(5)
    expect(nextAfter([2, 5, 9], 9)).toBe(2)
    expect(nextAfter([], 0)).toBeNull()
  })
})
