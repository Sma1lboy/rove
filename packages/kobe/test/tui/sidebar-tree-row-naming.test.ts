/**
 * `tree-row-naming.ts` — what a sidebar-tree row is CALLED and how it is
 * ADDRESSED. Split out of `sidebar-tree-core.test.ts` alongside the module
 * itself: none of these read a task LIST, they answer "what is this one row
 * called" and "which task and tab is this id".
 */

import { describe, expect, test } from "vitest"
import { parseRowId, rowLiveBranchPath, tabRowId, worktreeRowLabel } from "../../src/tui/panes/sidebar/tree-row-naming"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}

describe("tabRowId / parseRowId", () => {
  test("round-trips a tab row id", () => {
    expect(parseRowId(tabRowId("task-1", "tab-2"))).toEqual({ taskId: "task-1", tabId: "tab-2" })
  })

  test("a bare task id parses as no tab", () => {
    expect(parseRowId("task-1")).toEqual({ taskId: "task-1", tabId: null })
  })
})

describe("rowLiveBranchPath", () => {
  test("a Rove worktree carries its own branch — nothing to look up", () => {
    expect(rowLiveBranchPath(task("a", { branch: "feat/a" }))).toBe("")
  })

  test("main and dir rows resolve their own checkout's HEAD", () => {
    expect(rowLiveBranchPath(task("m", { kind: "main", branch: "", worktreePath: "/repos/rove" }))).toBe("/repos/rove")
    // A scratch shell is a dir task: opened inside a repo it IS on a branch,
    // and showing its path instead read as a different kind of row.
    const scratch = task("s", {
      kind: "dir",
      branch: "",
      scratch: true,
      worktreePath: "/Users/me/x",
      repo: "/Users/me/x",
    })
    expect(rowLiveBranchPath(scratch)).toBe("/Users/me/x")
  })

  test("a dir row with the live branch resolved is named by it, not by its path", () => {
    const dir = task("d", { kind: "dir", branch: "", worktreePath: "/Users/me/x", repo: "/Users/me/x" })
    expect(worktreeRowLabel(dir, { liveBranch: "main", home: "/Users/me" })).toBe("main")
    // Not a repo (poller answers "") → the path fallback still stands.
    expect(worktreeRowLabel(dir, { liveBranch: "", home: "/Users/me" })).toBe("~/x")
  })
})

describe("worktreeRowLabel", () => {
  test("a branch names the row, over everything else", () => {
    expect(worktreeRowLabel(task("a", { branch: "feat/a", title: "some title" }))).toBe("feat/a")
  })

  test("a main row's live HEAD outranks its (empty) stored branch", () => {
    const main = task("m", { kind: "main", branch: "", worktreePath: "/repos/rove" })
    expect(worktreeRowLabel(main, { liveBranch: "main" })).toBe("main")
    // HEAD not resolved yet (poller cold) → title fallback, same as before.
    expect(worktreeRowLabel(main, { home: "/Users/me" })).toBe("m")
  })

  test("a branchless dir task is named by its tail-truncated path — its stored title is ignored", () => {
    const dir = task("d", {
      kind: "dir",
      branch: "",
      title: "jacksonc-ab3x",
      worktreePath: "/Users/me/projects/deep/nested/dir",
      repo: "/Users/me/projects/deep/nested/dir",
    })
    const label = worktreeRowLabel(dir, { home: "/Users/me" })
    // "~/projects/deep/nested/dir" is 26 chars → tail-truncated to 24.
    expect(label).toBe("…rojects/deep/nested/dir")
    expect(label).not.toContain("jacksonc")
  })

  test("a path under $HOME tildifies before truncation", () => {
    const dir = task("d", { kind: "dir", branch: "", title: "", worktreePath: "/Users/me/tmp", repo: "/Users/me/tmp" })
    expect(worktreeRowLabel(dir, { home: "/Users/me" })).toBe("~/tmp")
  })

  test("a scratch task with an empty title never renders blank", () => {
    const scratch = task("s", {
      kind: "dir",
      scratch: true,
      branch: "",
      title: "",
      worktreePath: "/Users/me",
      repo: "/Users/me",
    })
    expect(worktreeRowLabel(scratch, { home: "/Users/me" })).toBe("~")
  })

  test("a regular task before its worktree materialises keeps its title", () => {
    expect(worktreeRowLabel(task("t", { branch: "", title: "fix the bug", worktreePath: "" }))).toBe("fix the bug")
  })

  test("nothing at all still yields a label", () => {
    const bare = task("x", { kind: "dir", branch: "", title: "", worktreePath: "", repo: "" })
    expect(worktreeRowLabel(bare)).toBe("scratch")
  })
})
