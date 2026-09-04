/**
 * What each tree row's right-click menu OFFERS (`tree-menu.ts` — pure, so the
 * list is a data assertion; the real right-click that produces it is covered
 * in the render track's `sidebar-tree-menu.test.tsx`).
 *
 * The rules worth locking: a project header offers exactly its three entries, the
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
  test("a project header offers New task, Field notes, then Remove project", () => {
    // New task / Remove project mirror chords the row already answers to (`d`
    // routes to `forgetProject` behind a confirm). Field notes is menu-only,
    // like setStatus: the repo's durable note store had no in-product reader.
    expect(actions(projectRow)).toEqual(["newTask", "fieldNotes", "forgetProject"])
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
      "openEditor",
      "renameBranch",
      "changeEngine",
      "syncBase",
      "land",
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
      "openEditor",
      "changeEngine",
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
      "openEditor",
      "changeEngine",
      "delete",
    ])
  })

  test("a dir row keeps every verb — pin and title-rename both work there", () => {
    const dirRow = worktreeRow({ kind: "dir", branch: "" })
    expect(actions(dirRow)).toContain("pin")
    expect(actions(dirRow)).toContain("rename")
  })

  test('Rename branch is withheld from any row whose branch is "" — main, dir, or a never-entered task', () => {
    // Same gate as Copy branch: `set-branch` has nothing to rename there (a
    // main row's branch is the live HEAD), so the entry could only end in the
    // error toast. Open in editor and Change engine stay — both work on any
    // task row.
    for (const row of [
      worktreeRow({ kind: "main", branch: "" }),
      worktreeRow({ kind: "dir", branch: "" }),
      worktreeRow({ branch: "" }),
    ]) {
      expect(actions(row)).not.toContain("renameBranch")
      expect(actions(row)).toContain("openEditor")
      expect(actions(row)).toContain("changeEngine")
    }
    expect(actions(worktreeRow())).toContain("renameBranch")
  })

  test("Land reaches only a materialised managed task — never main, dir, or a branchless row", () => {
    // `landTask` throws outright for a main or dir task (neither owns a
    // Rove-managed branch) and for a task that never materialised, so the
    // entry could only end in the error toast — the same
    // entry-that-does-nothing rule Rename branch follows.
    for (const row of [
      worktreeRow({ kind: "main", branch: "" }),
      worktreeRow({ kind: "dir", branch: "" }),
      worktreeRow({ branch: "" }),
    ]) {
      expect(actions(row)).not.toContain("land")
    }
    expect(actions(worktreeRow())).toContain("land")
    expect(actions(projectRow)).not.toContain("land")
  })

  test("the o/b/v trio never reaches a project header", () => {
    for (const verb of ["openEditor", "renameBranch", "changeEngine"]) expect(actions(projectRow)).not.toContain(verb)
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
      "openEditor",
      "renameBranch",
      "changeEngine",
      "syncBase",
      "land",
      "delete",
    ])
  })

  test("the LAST tab IS offered a close", () => {
    // Closing it leaves the task with no sessions; its sidebar row stays and
    // re-opens on ⏎ / ctrl+e. The entry is NOT withheld — closeTab accepts
    // the last tab.
    expect(actions(tabRow, { tabCount: 1 })).toContain("closeTab")
    expect(actions(tabRow, { tabCount: 1 })).toContain("newChat")
  })

  test("a tab row with NO known tabs is offered no close", () => {
    // `tabCount` 0 means the count could not be read; offering an action that
    // names nothing is the entry-that-does-nothing this module rules out.
    expect(actions(tabRow, { tabCount: 0 })).not.toContain("closeTab")
  })

  test("Run again is offered only to a task that stored a brief", () => {
    // `prompt` is recorded on the delivery path, so a task created without one
    // has nothing to re-fire — the entry-that-does-nothing rule. It sits right
    // after Reorder, before the status/copy block.
    expect(actions(worktreeRow())).not.toContain("runAgain")
    expect(actions(worktreeRow({ prompt: "print the third line\n\nthen stop" }))).toEqual([
      "open",
      "newChat",
      "newShell",
      "rename",
      "pin",
      "reorder",
      "runAgain",
      "setStatus",
      "copyBranch",
      "copyPath",
      "openEditor",
      "renameBranch",
      "changeEngine",
      "syncBase",
      "land",
      "delete",
    ])
  })

  test("Run again reaches a TAB row too, and never a project header", () => {
    // Same rule as the rest of the task verbs: a tab row carries them because
    // the chords walk up from a tab to its worktree.
    const withBrief: TreeRow = {
      kind: "tab",
      id: "a::tab-2",
      task: task({ prompt: "the brief" }),
      tab: { id: "tab-2", label: "tab 2" },
      depth: 2,
    }
    expect(actions(withBrief, { tabCount: 2 })).toContain("runAgain")
    expect(actions(projectRow)).not.toContain("runAgain")
  })

  test("an empty-string brief still counts — only an ABSENT one hides the entry", () => {
    // `setPrompt` rejects whitespace-only text, so "" can never be stored; the
    // gate is presence, and testing it as truthiness would hide that.
    expect(actions(worktreeRow({ prompt: "" }))).toContain("runAgain")
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

describe("the Fix-failing-checks entry", () => {
  // Gated on the PR chip the row already shows: with anything but `failing`
  // there is no log to fetch, and the entry could only end in a toast.
  test("is absent without a PR, and for passing / pending / unknown checks", () => {
    expect(actions(worktreeRow())).not.toContain("fixChecks")
    for (const checkState of ["none", "passing", "pending", "unknown"] as const) {
      const row = worktreeRow({ prStatus: { provider: "github", lifecycle: "open", checkState } })
      expect(actions(row), checkState).not.toContain("fixChecks")
    }
  })

  test("appears just before Land when the checks are red — on a tab row too", () => {
    const failing = { provider: "github", lifecycle: "open", checkState: "failing" } as const
    const rowActions = actions(worktreeRow({ prStatus: failing }))
    expect(rowActions).toContain("fixChecks")
    // Order: fixChecks → syncBase → land — CI, then drift, then the exit.
    expect(rowActions.indexOf("fixChecks")).toBe(rowActions.indexOf("syncBase") - 1)
    const tabActions = treeMenuItems({ ...tabRow, task: task({ prStatus: failing }) }).map((item) => item.action)
    expect(tabActions).toContain("fixChecks")
  })
})
