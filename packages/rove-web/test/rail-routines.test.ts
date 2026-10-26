import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { treeGuides } from "../src/rail-blocks.ts"
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

  test("the sessions hang under the count row as its children, drawn with the tree guides", () => {
    const rows = navRows(groups, "", new Set(["/r/app"]))
    expect(rows.map((row) => (row.kind === "task" ? row.depth : null))).toEqual([null, 1, null, 2, 2])
    expect(rows.flatMap((row, i) => (row.kind === "task" && row.depth > 1 ? [treeGuides(rows, i)] : []))).toEqual([
      ["tee"],
      ["elbow"],
    ])
  })

  test("a search opens every fold so a folded session stays findable", () => {
    expect(ids([], "sched-b")).toContain("sched-b")
  })
})
