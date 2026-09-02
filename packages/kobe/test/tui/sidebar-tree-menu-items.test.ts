/**
 * What each tree row's right-click menu OFFERS (`tree-menu.ts` — pure, so the
 * list is a data assertion; the real right-click that produces it is covered
 * in the render track's `sidebar-tree-menu.test.tsx`).
 *
 * The rules worth locking: a project header is only ever "New task", the
 * per-task verbs reach a tab row too, `closeTab` appears only above one tab,
 * and the new-conversation pair rides both task-bearing row kinds.
 */

import { describe, expect, test } from "vitest"
import type { TreeRow } from "../../src/tui/panes/sidebar/tree-core"
import { treeMenuItems } from "../../src/tui/panes/sidebar/tree-menu"
import { type Task, toTaskId } from "../../src/types/task"

function task(over: Partial<Task> = {}): Task {
  return {
    id: toTaskId("a"),
    title: "a",
    repo: "/repos/rove",
    branch: "feat/a",
    worktreePath: "/wt/a",
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}

const projectRow: TreeRow = { kind: "project", id: "/repos/rove", repo: "/repos/rove", label: "kobe", depth: 0 }
const worktreeRow = (over: Partial<Task> = {}): TreeRow => ({ kind: "worktree", id: "a", task: task(over), depth: 1 })
const tabRow: TreeRow = { kind: "tab", id: "a::tab-2", task: task(), tab: { id: "tab-2", label: "tab 2" }, depth: 2 }

const actions = (row: TreeRow, ctx = {}) => treeMenuItems(row, ctx).map((item) => item.action)

describe("treeMenuItems", () => {
  test("a project header offers New task and Remove project", () => {
    // Both mirror a chord the row already answers to — `d` on a project row
    // has always routed to `forgetProject` behind a confirm; the menu was
    // simply missing it.
    expect(actions(projectRow)).toEqual(["newTask", "forgetProject"])
  })

  test("a worktree row opens, adds a session, then the task verbs", () => {
    expect(actions(worktreeRow())).toEqual([
      "open",
      "newChat",
      "newShell",
      "rename",
      "pin",
      "reorder",
      "setStatus",
      "copyBranch",
      "copyPath",
      "delete",
    ])
  })

  test("a row with no stored branch is offered Copy path but not Copy branch", () => {
    // `main`/`dir` rows store `branch === ""` (their label is the live HEAD),
    // so the entry would copy nothing — the entry-that-does-nothing rule.
    const dirRow = worktreeRow({ kind: "dir", branch: "" })
    expect(actions(dirRow)).toContain("copyPath")
    expect(actions(dirRow)).not.toContain("copyBranch")
  })

  test("a task never entered (both fields still empty) is offered neither copy", () => {
    // `ensureWorktree` fills branch + worktreePath on first enter; before that
    // there is nothing to copy, and the menu says so by omission.
    const lazy = worktreeRow({ branch: "", worktreePath: "" })
    expect(actions(lazy)).not.toContain("copyBranch")
    expect(actions(lazy)).not.toContain("copyPath")
  })

  test("a main row (the project's own checkout) is not offered a pin — setPinned silently no-ops on it", () => {
    const mainRow = worktreeRow({ kind: "main", branch: "", worktreePath: "/repos/rove" })
    expect(actions(mainRow)).toEqual([
      "open",
      "newChat",
      "newShell",
      "rename",
      "reorder",
      "setStatus",
      "copyPath",
      "delete",
    ])
    const mainTab: TreeRow = {
      kind: "tab",
      id: "a::tab-2",
      task: task({ kind: "main", branch: "", worktreePath: "/repos/rove" }),
      tab: { id: "tab-2", label: "tab 2" },
      depth: 2,
    }
    expect(actions(mainTab, { tabCount: 2 })).toEqual([
      "open",
      "closeTab",
      "newChat",
      "newShell",
      "rename",
      "reorder",
      "setStatus",
      "copyPath",
      "delete",
    ])
  })

  test("a dir row keeps every verb — pin and title-rename both work there", () => {
    const dirRow = worktreeRow({ kind: "dir", branch: "" })
    expect(actions(dirRow)).toContain("pin")
    expect(actions(dirRow)).toContain("rename")
  })

  test("a tab row carries the same session + task verbs, plus its own close", () => {
    expect(actions(tabRow, { tabCount: 2 })).toEqual([
      "open",
      "closeTab",
      "newChat",
      "newShell",
      "rename",
      "pin",
      "reorder",
      "setStatus",
      "copyBranch",
      "copyPath",
      "delete",
    ])
  })

  test("the LAST tab IS offered a close (owner call 2026-08-31)", () => {
    // Closing it leaves the task with no sessions; its sidebar row stays and
    // re-opens on ⏎ / ctrl+e. The entry used to be withheld because closeTab
    // refused the last tab, which is no longer true.
    expect(actions(tabRow, { tabCount: 1 })).toContain("closeTab")
    expect(actions(tabRow, { tabCount: 1 })).toContain("newChat")
  })

  test("a tab row with NO known tabs is offered no close", () => {
    // `tabCount` 0 means the count could not be read; offering an action that
    // names nothing is the entry-that-does-nothing this module rules out.
    expect(actions(tabRow, { tabCount: 0 })).not.toContain("closeTab")
  })

  test("pin reads the task's own state", () => {
    const label = (row: TreeRow) => treeMenuItems(row).find((item) => item.action === "pin")?.labelKey
    expect(label(worktreeRow())).toBe("tasks.menu.pin")
    expect(label(worktreeRow({ pinned: true }))).toBe("tasks.menu.unpin")
  })

  test("delete is the only entry painted as destructive", () => {
    const danger = treeMenuItems(worktreeRow())
      .filter((item) => item.danger === true)
      .map((item) => item.action)
    expect(danger).toEqual(["delete"])
  })
})
