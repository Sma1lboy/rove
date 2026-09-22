/**
 * Unit tests for the shared git porcelain/numstat parser
 * (`src/lib/git-parsers.ts`).
 *
 * The hard cases — verified against real `git status --porcelain` /
 * `git diff --numstat -z` output — are:
 *   - C-string unquoting: git wraps any path with a space (porcelain
 *     renames), a tab/newline/quote, or a non-ASCII byte in a double-quoted,
 *     C-escaped string, and emits non-ASCII as three-digit OCTAL bytes
 *     (`\303\274` = the UTF-8 bytes of `ü`).
 *   - rename resolution: porcelain uses ` -> ` with each side quoted
 *     independently; numstat uses `-z` and emits the source and destination paths as
 *     separate NUL-delimited fields, avoiding brace-compaction ambiguity.
 *   - the join: porcelain quotes a spaced path (`"a b.txt"`) while numstat
 *     with `-z` emits the raw path (`a b.txt\0`); unquoting BOTH yields one
 *     canonical path so a renamed/modified spaced file's numstat counts key
 *     onto its status row.
 */

import { describe, expect, test } from "vitest"
import { type NumstatRow, parseNumstatRows, parsePorcelainRows, unquoteGitPath } from "../../src/lib/git-parsers"

describe("unquoteGitPath", () => {
  test("decodes escaped quote and backslash", () => {
    expect(unquoteGitPath('"a\\"b\\\\c.txt"')).toBe('a"b\\c.txt')
  })

  test("decodes octal byte escapes as UTF-8 (ü)", () => {
    expect(unquoteGitPath('"\\303\\274nicode.txt"')).toBe("ünicode.txt")
  })
})

describe("parsePorcelainRows", () => {
  test("parses index/worktree status pairs and untracked", () => {
    const raw = [" M src/a.ts", "M  src/b.ts", "A  src/c.ts", "?? src/d.ts", ""].join("\n")
    expect(parsePorcelainRows(raw)).toEqual([
      { x: " ", y: "M", path: "src/a.ts" },
      { x: "M", y: " ", path: "src/b.ts" },
      { x: "A", y: " ", path: "src/c.ts" },
      { x: "?", y: "?", path: "src/d.ts" },
    ])
  })

  test("skips the branch-header line and blank/short lines", () => {
    const raw = ["## main...origin/main [ahead 2]", "", "x", " M ok.ts"].join("\n")
    expect(parsePorcelainRows(raw)).toEqual([{ x: " ", y: "M", path: "ok.ts" }])
  })

  test("preserves merge-conflict XY pairs (UU / AA / DD)", () => {
    const raw = ["UU both.ts", "AA added.ts", "DD gone.ts"].join("\n")
    expect(parsePorcelainRows(raw)).toEqual([
      { x: "U", y: "U", path: "both.ts" },
      { x: "A", y: "A", path: "added.ts" },
      { x: "D", y: "D", path: "gone.ts" },
    ])
  })

  test("resolves a rename: new path quoted, old path bare", () => {
    expect(parsePorcelainRows('R  normal.txt -> "renamed normal.txt"')).toEqual([
      { x: "R", y: " ", path: "renamed normal.txt", origPath: "normal.txt" },
    ])
  })

  test("resolves a rename+modify (RM) row", () => {
    expect(parsePorcelainRows('RM "src/has space.txt" -> "src/has space2.txt"')).toEqual([
      { x: "R", y: "M", path: "src/has space2.txt", origPath: "src/has space.txt" },
    ])
  })
})

const numstat = (path: string, added: number | null, deleted: number | null, origPath?: string): NumstatRow =>
  origPath !== undefined ? { path, origPath, added, deleted } : { path, added, deleted }

describe("parseNumstatRows", () => {
  test("surfaces binary `-` counts as null", () => {
    expect(parseNumstatRows("-\t-\tassets/logo.png\0")).toEqual([numstat("assets/logo.png", null, null)])
  })

  test("parses multiple NUL-delimited records", () => {
    expect(parseNumstatRows("3\t1\ta.ts\0" + "5\t0\tb.ts\0")).toEqual([numstat("a.ts", 3, 1), numstat("b.ts", 5, 0)])
  })

  test("skips malformed fields", () => {
    // A field with no tabs and a valid record after it.
    expect(parseNumstatRows("notatabline\0" + "3\t1\ta.ts\0")).toEqual([numstat("a.ts", 3, 1)])
  })

  test("resolves a same-directory rename", () => {
    // `git diff --numstat -z` emits the source and destination paths as separate fields.
    expect(parseNumstatRows("0\t0\t\0src/old.txt\0src/new.txt\0")).toEqual([
      numstat("src/new.txt", 0, 0, "src/old.txt"),
    ])
  })

  test("does not mangle a normal path that merely contains a brace", () => {
    expect(parseNumstatRows("1\t0\tsrc/{shared}/util.ts\0")).toEqual([numstat("src/{shared}/util.ts", 1, 0)])
  })

  test("a literal brace survives a rename path", () => {
    // Brace-compaction makes this path unparseable without `-z`:
    //   path:       src/{a{b/f.txt  →  src/c/f.txt
    //   non-z:      src/{{a{b => c}/f.txt   (three `{`, ambiguous)
    // With `-z` the two paths are independent fields.
    expect(parseNumstatRows("0\t0\t\0src/{a{b/f.txt\0src/c/f.txt\0")).toEqual([
      numstat("src/c/f.txt", 0, 0, "src/{a{b/f.txt"),
    ])
  })
})

describe("porcelain ↔ numstat path coherence (the join the bug breaks)", () => {
  test("a spaced rename resolves to the SAME canonical path in both formats", () => {
    // Porcelain quotes the spaced paths; numstat with `-z` emits raw paths.
    // Both must unquote/resolve to `src/has space2.txt` so the numstat counts
    // key onto the porcelain `R` row.
    const [p] = parsePorcelainRows('R  "src/has space.txt" -> "src/has space2.txt"')
    const [n] = parseNumstatRows("4\t2\t\0src/has space.txt\0src/has space2.txt\0")
    expect(p?.path).toBe("src/has space2.txt")
    expect(n?.path).toBe("src/has space2.txt")
    expect(p?.path).toBe(n?.path)
  })

  test("a spaced (non-rename) modify resolves identically across formats", () => {
    // Porcelain quotes `"a b.txt"`; numstat with `-z` emits the raw path.
    const [p] = parsePorcelainRows(' M "a b.txt"')
    const [n] = parseNumstatRows("1\t0\ta b.txt\0")
    expect(p?.path).toBe("a b.txt")
    expect(n?.path).toBe("a b.txt")
  })

  test("a move OUT of a subdirectory keys onto the same porcelain path", () => {
    // `git mv src/sub/a.txt src/a.txt`. Porcelain reports the full new path;
    // numstat with `-z` emits the source and destination paths as separate fields. Both
    // must resolve to `src/a.txt` or the +/- counts orphan from the status row.
    const [p] = parsePorcelainRows("R  src/sub/a.txt -> src/a.txt")
    const [n] = parseNumstatRows("4\t2\t\0src/sub/a.txt\0src/a.txt\0")
    expect(p?.path).toBe("src/a.txt")
    expect(n?.path).toBe("src/a.txt")
    expect(p?.path).toBe(n?.path)
    expect(n?.origPath).toBe("src/sub/a.txt")
  })
})
