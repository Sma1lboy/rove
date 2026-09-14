import { expect, it } from "vitest"
import { sameHistoryWorktree } from "../../src/engine/history-worktree"

it.each([
  ["C:\\Users\\jackson\\repo", "C:/Users/jackson/repo", true],
  ["\\\\server\\share\\repo", "//server/share/repo", true],
  ["C:\\Users\\jackson\\repo", "C:/Users/jackson/other", false],
  ["/repo/a", "/repo/A", false],
  ["/repo/a\\b", "/repo/a/b", false],
  [undefined, "/repo", false],
  ["", "", false],
])("compares history cwd %s with %s", (recorded, worktree, expected) => {
  expect(sameHistoryWorktree(recorded, worktree)).toBe(expected)
})
