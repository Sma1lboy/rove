/**
 * What each tree row's right-click menu OFFERS (`tree-menu.ts` — pure, so the
 * list is a data assertion; the real right-click that produces it is covered
 * in the render track's `sidebar-tree-menu.test.tsx`).
 *
 * The rules worth locking: a project header offers its entries (move verbs only
 * when movable, minus the dead ones at either end), a task with children offers Collapse/Expand, and the
 * new-conversation pair rides every task row.
 */

import { describe, expect, test } from "vitest"
import { findBinding } from "../../src/keys/keybindings"
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

const projectRow: TreeRow = {
  kind: "project",
  machineId: "local",
  id: "/repos/rove",
  repo: "/repos/rove",
  label: "rove",
  depth: 0,
}
const worktreeRow = (over: Partial<Task> = {}): TreeRow => ({ kind: "worktree", id: "a", task: task(over), depth: 1 })

const actions = (row: TreeRow, ctx = {}) => treeMenuItems(row, ctx).map((item) => item.action)

describe("treeMenuItems", () => {
  test("a project header offers New task, Field notes, then Remove project", () => {
    // Remove project and Field notes are menu-only: the repo's durable note store had no in-product reader.
    expect(actions(projectRow)).toEqual(["newTask", "fieldNotes", "forgetProject"])
  })

  test("a movable project adds Move to top / up / down; the topmost and bottommost drop the dead ones", () => {
    expect(actions(projectRow, { projectMovable: true })).toEqual([
      "newTask",
      "moveToTop",
      "moveProjectUp",
      "moveProjectDown",
      "fieldNotes",
      "forgetProject",
    ])
    expect(actions(projectRow, { projectMovable: true, projectFirst: true })).toEqual([
      "newTask",
      "moveProjectDown",
      "fieldNotes",
      "forgetProject",
    ])
    expect(actions(projectRow, { projectMovable: true, projectLast: true })).toEqual([
      "newTask",
      "moveToTop",
      "moveProjectUp",
      "fieldNotes",
      "forgetProject",
    ])
  })

  test("only a top-level local task is offered Move to project", () => {
    expect(actions(worktreeRow({ parentTaskId: "p1" as never }))).not.toContain("moveToProject")
  })

  test("a worktree row adds a session, then the task verbs", () => {
    expect(actions(worktreeRow())).toEqual([
      "newChat",
      "newShell",
      "continueEngine",
      "newTaskFromBranch",
      "rename",
      "pin",
      "reorder",
      "setStatus",
      "muteNotifications",
      "moveToProject",
      "copyId",
      "copyBranch",
      "copyPath",
      "openEditor",
      "renameBranch",
      "changeEngine",
      "syncBase",
      "land",
      "archive",
      "delete",
    ])
  })

  test("the mute entry reads Unmute while the task is muted", () => {
    const label = (notificationsMuted: boolean) =>
      treeMenuItems(worktreeRow(), { notificationsMuted }).find((item) => item.action === "muteNotifications")?.labelKey
    expect(label(false)).toBe("tasks.menu.muteNotifications")
    expect(label(true)).toBe("tasks.menu.unmuteNotifications")
  })

  test("New task from this branch reaches only a local single-repo managed branch", () => {
    // Any other row has no branch of its own in this repo to base the new worktree on.
    const offered = (over: Partial<Task>) => actions(worktreeRow(over)).includes("newTaskFromBranch")
    expect(offered({})).toBe(true)
    expect(offered({ kind: "dir", branch: "", worktreePath: "/home/me/notes" })).toBe(false)
    expect(offered({ branch: "", worktreePath: "" })).toBe(false)
    expect(offered({ sharesWorkspaceOf: toTaskId("p1") })).toBe(false)
    expect(
      offered({ extraRepos: [{ repo: "/repos/api", branch: "feat/a", worktreePath: "/wt/a-api" }] as never }),
    ).toBe(false)
    expect(offered({ origin: { machineId: "laptop" } as never })).toBe(false)
  })

  test("a row with no stored branch is offered Copy path but not Copy branch", () => {
    // `dir` rows store `branch === ""` (their label is the live HEAD),
    // so the entry would copy nothing — the entry-that-does-nothing rule.
    const dirRow = worktreeRow({ kind: "dir", branch: "" })
    expect(actions(dirRow)).toContain("copyPath")
    expect(actions(dirRow)).not.toContain("copyBranch")
  })

  test("a task never entered (both fields still empty) is offered neither copy", () => {
    // `ensureWorktree` fills branch + worktreePath on first enter; before that
    // there is nothing to copy, and the menu says so by omission. The id exists
    // from creation, so `rove api` can already address it.
    const lazy = worktreeRow({ branch: "", worktreePath: "" })
    expect(actions(lazy)).not.toContain("copyBranch")
    expect(actions(lazy)).not.toContain("copyPath")
    expect(actions(lazy)).toContain("copyId")
  })

  test("a dir row keeps every verb — pin and title-rename both work there", () => {
    const dirRow = worktreeRow({ kind: "dir", branch: "" })
    expect(actions(dirRow)).toContain("pin")
    expect(actions(dirRow)).toContain("rename")
  })

  const branchless = [
    ["dir", worktreeRow({ kind: "dir", branch: "" })],
    ["never-entered", worktreeRow({ branch: "" })],
  ] as const

  // Same gate as Copy branch: `set-branch` has nothing to rename there (a
  // dir row's branch is the live HEAD), so the entry could only end in the
  // error toast. Open in editor and Change engine stay — both work on any
  // task row.
  test.each(branchless)('Rename branch is withheld from a %s row, whose branch is ""', (_name, row) => {
    expect(actions(row)).not.toContain("renameBranch")
    expect(actions(row)).toContain("openEditor")
    expect(actions(row)).toContain("changeEngine")
  })

  // `landTask` throws outright for a dir task (it owns no
  // Rove-managed branch) and for a task that never materialised, so the
  // entry could only end in the error toast.
  test.each(branchless)("Land never reaches a %s row", (_name, row) => {
    expect(actions(row)).not.toContain("land")
  })

  test("a task with children offers Collapse, or Expand once folded; a leaf offers neither", () => {
    const parent = (collapsed: boolean): TreeRow => ({
      kind: "worktree",
      id: "a",
      task: task(),
      depth: 1,
      fold: { count: 2, collapsed, descendantIds: ["x", "y"] },
    })
    const label = (row: TreeRow) => treeMenuItems(row).find((item) => item.action === "toggleFold")?.labelKey
    expect(label(parent(false))).toBe("tasks.menu.collapseChildren")
    expect(label(parent(true))).toBe("tasks.menu.expandChildren")
    expect(actions(worktreeRow())).not.toContain("toggleFold")
  })

  test("Run again is offered only to a task that stored a brief", () => {
    // `prompt` is recorded on the delivery path, so a task created without one
    // has nothing to re-fire — the entry-that-does-nothing rule. It sits right
    // after Reorder, before the status/copy block.
    expect(actions(worktreeRow())).not.toContain("runAgain")
    const withBrief = actions(worktreeRow({ prompt: "print the third line\n\nthen stop" }))
    const at = withBrief.indexOf("reorder")
    expect(withBrief.slice(at, at + 3)).toEqual(["reorder", "runAgain", "setStatus"])
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

describe("the failing-checks entries", () => {
  // Gated on the PR chip the row already shows: with anything but `failing`
  // there is no log to fetch or job to restart, so either could only toast.
  test.each<[string, TreeRow]>([
    ["no PR", worktreeRow()],
    ...(["none", "passing", "pending", "unknown"] as const).map((checkState): [string, TreeRow] => [
      `${checkState} checks`,
      worktreeRow({ prStatus: { provider: "github", lifecycle: "open", checkState } }),
    ]),
  ])("is absent with %s", (_name, row) => {
    expect(actions(row)).not.toContain("fixChecks")
    expect(actions(row)).not.toContain("rerunChecks")
  })

  test("appears just before Land when the checks are red", () => {
    const failing = { provider: "github", lifecycle: "open", checkState: "failing" } as const
    const rowActions = actions(worktreeRow({ prStatus: failing }))
    // Order: fixChecks → rerunChecks → syncBase → land — CI, then drift, then the exit.
    const ci = rowActions.indexOf("fixChecks")
    expect(ci).toBeGreaterThan(-1)
    expect(rowActions.slice(ci, ci + 3)).toEqual(["fixChecks", "rerunChecks", "syncBase"])
  })
})

describe("the resolve-conflicts entry", () => {
  // Gated on a paused merge/rebase in the worktree: otherwise the engine would
  // get a prompt about conflicts that do not exist.
  test("appears between Sync with base and Land only while an operation is paused", () => {
    expect(actions(worktreeRow())).not.toContain("resolveConflicts")
    const rowActions = actions(worktreeRow(), { operationPaused: true })
    const at = rowActions.indexOf("syncBase")
    expect(rowActions.slice(at, at + 3)).toEqual(["syncBase", "resolveConflicts", "land"])
  })
})

describe("the chord an entry advertises", () => {
  const everyItem = [
    ...treeMenuItems(projectRow),
    ...treeMenuItems(worktreeRow({ prStatus: { provider: "github", lifecycle: "open", checkState: "failing" } })),
  ]

  test("every declared bindingId is a real keymap row", () => {
    // A renamed or dropped id would not throw — `legendCap` returns null and
    // the entry silently loses its cap forever, which looks exactly like a
    // menu-only verb. The id is the only link between the two files.
    const dangling = everyItem
      .flatMap((item) => (item.bindingId ? [item.bindingId] : []))
      .filter((id) => findBinding(id) === undefined)

    expect(dangling).toEqual([])
  })

  test("the menu-only verbs stay menu-only", () => {
    // These eight have no chord anywhere in the product; the menu is their one
    // route. Claiming a bindingId here would print a cap for a key that does
    // not reach them.
    const menuOnly = ["setStatus", "copyId", "copyTab", "copyBranch", "copyPath", "runAgain", "fieldNotes", "land"]
    const withId = everyItem.flatMap((item) => (item.bindingId ? [item.action] : []))
    expect(withId.filter((action) => menuOnly.includes(action))).toEqual([])
  })
})
