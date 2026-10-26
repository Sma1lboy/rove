import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { withArchived } from "../src/rail-archived.ts"
import { railRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/app", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow

const ids = (tasks: TaskRow[], query = "") =>
  railRows({ tasks, remote: [], machines: [], sort: "default", query }).rows.map((row) => row.id)

describe("routine runs stay on the Routines page", () => {
  test("the rail lists none, a search included", () => {
    const tasks = [task("own"), task("sched-a", { routine: true }), task("sched-b", { routine: true })]
    expect(ids(tasks)).toEqual(["project:/r/app", "own"])
    expect(ids(tasks, "sched")).not.toContain("sched-a")
  })

  test("a task started from a routine run sits at the top level", () => {
    expect(ids([task("sched", { routine: true }), task("kid", { parentTaskId: "sched" })])).toEqual([
      "project:/r/app",
      "kid",
    ])
  })

  test("the Archived fold neither counts nor lists archived runs", () => {
    const archived = [task("old"), task("old-run", { routine: true })]
    expect(withArchived([], archived, false)).toEqual([
      { id: "~archived", kind: "archived", count: 1, expanded: false },
    ])
    expect(withArchived([], [task("old-run", { routine: true })], true)).toEqual([])
  })
})
