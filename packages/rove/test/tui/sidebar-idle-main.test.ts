import { describe, expect, test } from "vitest"
import { type TreeTab, buildTreeRows, treeFlatIds } from "../../src/tui/panes/sidebar/tree-core"
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

const tab = (id: string, label = id): TreeTab => ({ id, label })

function rows(over: Partial<Parameters<typeof buildTreeRows>[0]> = {}) {
  return buildTreeRows({ tasks: [], tabsByTask: new Map(), ...over })
}

/** A project's main row is not listed while it has no tab, is not selected and has no child task. */
describe("a tabless main row", () => {
  const mainOf = (repo: string, id = "m") => task(id, { kind: "main", repo, title: repo.split("/").pop() ?? repo })

  test("a tabless main is not a row beside the project's worktree tasks, but the header and the tasks stay", () => {
    // The worktree rows are how you get back to that work — losing them would
    // strand the branches. The main stays as the project's anchor, just unlisted.
    const out = rows({
      tasks: [mainOf("/repos/rove"), task("a", { repo: "/repos/rove" })],
      tabsByTask: new Map([
        ["m", []],
        ["a", []],
      ]),
    })
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree"])
    expect(out.flatMap((r) => (r.kind === "worktree" ? [r.id] : []))).toEqual([toTaskId("a")])
  })

  test("a main with unknown tabs keeps its row beside the tasks (fresh TUI: no flicker at boot)", () => {
    const out = rows({ tasks: [mainOf("/repos/rove"), task("a", { repo: "/repos/rove" })], tabsByTask: new Map() })
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree", "worktree"])
  })

  test("against the daemon's tab store, a main with no record has no tabs and is not a row", () => {
    // A fresh `rove api add --repo` main never had a tab, so the daemon holds no record for it.
    const tasks = [mainOf("/repos/rove"), task("a", { repo: "/repos/rove" })]
    const out = rows({ tasks, tabsByTask: new Map(), tabsDaemonBacked: true })
    expect(out.flatMap((r) => (r.kind === "worktree" ? [r.id] : []))).toEqual([toTaskId("a")])
    // The tasks keep their own reading: no record on a worktree task is still just a task.
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree"])
  })

  test("against the daemon's tab store, a project with only a record-less main stays listed", () => {
    // A repo that was just saved has no record and no other row: only known-empty tabs close it down.
    const out = rows({ tasks: [mainOf("/repos/rove")], tabsByTask: new Map(), tabsDaemonBacked: true })
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree"])
  })

  test("against the daemon's tab store, another machine's main with no record keeps its row", () => {
    const remote = task("r", { kind: "main", repo: "/repos/rove", origin: { machineId: "box" } as Task["origin"] })
    const out = rows({
      tasks: [remote, task("a", { repo: "/repos/rove" })],
      tabsByTask: new Map(),
      tabsDaemonBacked: true,
    })
    expect(out.flatMap((r) => (r.kind === "worktree" ? [r.id] : []))).toEqual([toTaskId("r"), toTaskId("a")])
  })

  test("against the daemon's tab store, a main with a tab or the selection keeps its row", () => {
    const tasks = [mainOf("/repos/rove"), task("a", { repo: "/repos/rove" })]
    const withTab = rows({ tasks, tabsByTask: new Map([["m", [tab("t1")]]]), tabsDaemonBacked: true })
    expect(withTab.map((r) => r.kind)).toEqual(["project", "worktree", "worktree"])
    const selected = rows({
      tasks,
      tabsByTask: new Map(),
      tabsDaemonBacked: true,
      keepTaskIds: new Set([toTaskId("m")]),
    })
    expect(selected.map((r) => r.kind)).toEqual(["project", "worktree", "worktree"])
  })

  test("a main with a tab open keeps its row first, ahead of the tasks", () => {
    const out = rows({
      tasks: [mainOf("/repos/rove"), task("a", { repo: "/repos/rove" })],
      tabsByTask: new Map([["m", [tab("t1")]]]),
    })
    expect(out.flatMap((r) => (r.kind === "worktree" ? [r.id] : []))).toEqual([toTaskId("m"), toTaskId("a")])
  })

  test("a tabless main that is selected or held open keeps its row", () => {
    const tasks = [mainOf("/repos/rove"), task("a", { repo: "/repos/rove" })]
    const tabsByTask = new Map([["m", []]])
    const ids = (keep: string[]) =>
      rows({ tasks, tabsByTask, keepTaskIds: new Set(keep.map(toTaskId)) }).flatMap((r) =>
        r.kind === "worktree" ? [r.id] : [],
      )
    expect(ids([])).toEqual([toTaskId("a")])
    expect(ids(["m"])).toEqual([toTaskId("m"), toTaskId("a")])
  })

  test("a tabless main with a child task keeps its row, so the child stays nested under it", () => {
    const out = rows({
      tasks: [mainOf("/repos/rove"), task("kid", { repo: "/repos/rove", parentTaskId: toTaskId("m") })],
      tabsByTask: new Map([["m", []]]),
    })
    const worktrees = out.flatMap((r) => (r.kind === "worktree" ? [r] : []))
    expect(worktrees.map((r) => [r.id, r.depth])).toEqual([
      [toTaskId("m"), 1],
      [toTaskId("kid"), 2],
    ])
  })

  test("the hidden main is not navigable, and the header stays", () => {
    const out = rows({
      tasks: [mainOf("/repos/rove"), task("a", { repo: "/repos/rove" })],
      tabsByTask: new Map([["m", []]]),
    })
    expect(treeFlatIds(out)).toEqual([toTaskId("a")])
  })
})
