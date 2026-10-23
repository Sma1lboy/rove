import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { groupByProject, navRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/app", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow

describe("routine sessions in the rail", () => {
  const groups = groupByProject([task("own"), task("sched-a", { routine: true }), task("sched-b", { routine: true })])
  const ids = (open: string[], query = "") => navRows(groups, query, new Set(open)).map((row) => row.id)

  test("a closed fold is one count row after the project's own tasks", () => {
    expect(ids([])).toEqual(["project:/r/app", "own", "~routines:/r/app"])
  })

  test("an open fold lists the sessions under the count row", () => {
    expect(ids(["/r/app"])).toEqual(["project:/r/app", "own", "~routines:/r/app", "sched-a", "sched-b"])
  })

  test("a search opens every fold so a folded session stays findable", () => {
    expect(ids([], "sched-b")).toContain("sched-b")
  })
})
