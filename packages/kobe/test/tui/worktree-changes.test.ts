import { describe, expect, test } from "vitest"
import { parsePorcelain, pickPushedChanges, sameWorktreeChanges } from "../../src/tui/panes/sidebar/worktree-changes"

describe("parsePorcelain", () => {
  test("returns zeros for empty input", () => {
    expect(parsePorcelain("")).toEqual({ added: 0, deleted: 0 })
  })

  test("counts modified, added, untracked as `added`", () => {
    const text = [" M src/a.ts", "M  src/b.ts", "A  src/c.ts", "?? src/d.ts", ""].join("\n")
    expect(parsePorcelain(text)).toEqual({ added: 4, deleted: 0 })
  })

  test("counts deletions in either column as `deleted`", () => {
    const text = [" D src/a.ts", "D  src/b.ts", "AD src/c.ts", ""].join("\n")
    expect(parsePorcelain(text)).toEqual({ added: 0, deleted: 3 })
  })

  test("ignores branch-header line if present", () => {
    const text = ["## main...origin/main [ahead 2, behind 1]", " M src/a.ts", " D src/b.ts", ""].join("\n")
    expect(parsePorcelain(text)).toEqual({ added: 1, deleted: 1 })
  })

  test("clean tree yields zeros", () => {
    expect(parsePorcelain("\n")).toEqual({ added: 0, deleted: 0 })
  })
})

// The sidebar's source-preference seam: a non-null pushed map
// means the daemon owns collection — including for rows ABSENT from the
// map (remote / just-created), which must read as zeros, never
// as "poll locally", or panes would re-grow git polls for exactly the
// rows the daemon deliberately skips.
describe("pickPushedChanges", () => {
  const pushed = new Map([["/wt/a", { added: 3, deleted: 1 }]])

  test("null/undefined map → null (local-poller fallback engages)", () => {
    expect(pickPushedChanges(null, "/wt/a")).toBeNull()
    expect(pickPushedChanges(undefined, "/wt/a")).toBeNull()
  })

  test("a tracked worktree reads its pushed counts", () => {
    expect(pickPushedChanges(pushed, "/wt/a")).toEqual({ added: 3, deleted: 1 })
  })

  test("a worktree absent from a non-null map reads zeros, not fallback", () => {
    expect(pickPushedChanges(pushed, "/wt/absent")).toEqual({ added: 0, deleted: 0 })
  })

  test("absent keys share one zeros reference (memo-equality friendly)", () => {
    expect(pickPushedChanges(pushed, "/wt/x")).toBe(pickPushedChanges(new Map(), "/wt/y"))
  })
})

describe("sameWorktreeChanges", () => {
  test("compares both counts", () => {
    expect(sameWorktreeChanges({ added: 1, deleted: 2 }, { added: 1, deleted: 2 })).toBe(true)
    expect(sameWorktreeChanges({ added: 1, deleted: 2 }, { added: 1, deleted: 3 })).toBe(false)
    expect(sameWorktreeChanges({ added: 0, deleted: 0 }, { added: 1, deleted: 0 })).toBe(false)
  })

  test("a change in `ahead` alone is a change", () => {
    // A worker that commits moves nothing but this: `added`/`deleted` drop to
    // zero and stay there. An equality that ignored `ahead` would freeze the
    // row's memo at the pre-commit value and the `↑N` chip would never draw.
    expect(sameWorktreeChanges({ added: 0, deleted: 0, ahead: 0 }, { added: 0, deleted: 0, ahead: 1 })).toBe(false)
    expect(sameWorktreeChanges({ added: 0, deleted: 0 }, { added: 0, deleted: 0, ahead: 0 })).toBe(false)
    expect(sameWorktreeChanges({ added: 0, deleted: 0, ahead: 2 }, { added: 0, deleted: 0, ahead: 2 })).toBe(true)
  })
})

describe("pickPushedChanges and the daemon's unreadable list", () => {
  // Three distinct facts share this one lookup, and collapsing any two of them
  // is how an unreadable worktree came to render as a clean one.
  test("separates counts, not-collected, and could-not-read", () => {
    const pushed = new Map<string, { added: number; deleted: number } | null>([
      ["/wt/ok", { added: 2, deleted: 1 }],
      // The daemon TRACKED this one and its git status failed.
      ["/wt/broken", null],
    ])
    expect(pickPushedChanges(pushed, "/wt/ok")).toEqual({ added: 2, deleted: 1 })
    expect(pickPushedChanges(pushed, "/wt/broken")).toBe("unknown")
    // Absent = the daemon does not collect it (remote project, fresh task).
    // Still zeros: the row draws no chip, which is what it has always done.
    expect(pickPushedChanges(pushed, "/wt/never-collected")).toEqual({ added: 0, deleted: 0 })
    // No daemon at all — the caller falls back to the local poller.
    expect(pickPushedChanges(null, "/wt/ok")).toBeNull()
  })
})
