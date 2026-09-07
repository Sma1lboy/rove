/**
 * `countPorcelain` — the sidebar's `+N −M` chips — must agree with the shared
 * porcelain parser it is now built on.
 *
 * The daemon-side counter used to re-scan the lines itself with a laxer filter
 * (`line.length < 3` and no separator check) than `parsePorcelainRows`
 * (`line.length < 4` plus `line[2] === " "`). Both survived because the twelve
 * porcelain edge-case tests in `test/lib/git-parsers.test.ts` exercised kobe's
 * parser while the daemon's copy was the one actually feeding the UI. These
 * cover the two inputs where the two implementations disagreed, so a
 * re-introduced local scan fails here.
 */
import { countPorcelain } from "@sma1lboy/kobe-daemon/daemon/worktree-changes-collector"
import { describe, expect, it } from "vitest"

describe("countPorcelain agrees with parsePorcelainRows", () => {
  it("skips a status pair with no path (the laxer counter added it)", () => {
    // "M  " is 3 chars: status pair + separator, empty path. Long enough for
    // the old `length < 3` guard, too short to name a file.
    expect(countPorcelain("M  ")).toEqual({ added: 0, deleted: 0 })
    expect(countPorcelain("M  a.txt\nM  ")).toEqual({ added: 1, deleted: 0 })
  })

  it("skips a line with no separator in column 3 (the laxer counter added it)", () => {
    // Anything that is not `XY <path>` — a stray warning, a truncated read —
    // is not a change. The old counter billed it as an addition.
    expect(countPorcelain("fatal: not a git repository")).toEqual({ added: 0, deleted: 0 })
    expect(countPorcelain("MMM")).toEqual({ added: 0, deleted: 0 })
  })

  it("still counts the real shapes: staged/unstaged, deletes on either side, renames, quoted paths", () => {
    const out = [
      "M  src/a.ts", // staged modify
      " M src/b.ts", // unstaged modify
      "D  src/gone.ts", // staged delete (X)
      " D src/vanished.ts", // unstaged delete (Y)
      '?? "src/has space.txt"', // untracked, quoted
      'R  "src/old name.txt" -> "src/new name.txt"', // rename, both sides quoted
      "## main...origin/main", // branch header — never a change
    ].join("\n")
    expect(countPorcelain(out)).toEqual({ added: 4, deleted: 2 })
  })

  it("tolerates CRLF and a trailing blank line", () => {
    expect(countPorcelain("M  a.txt\r\nD  b.txt\r\n")).toEqual({ added: 1, deleted: 1 })
  })
})
