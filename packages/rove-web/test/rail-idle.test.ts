import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { dropIdleMains } from "../src/rail-idle.ts"
import { railRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/shop", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const main = task("shop", { kind: "main" })
const run = task("daily-release", { routine: true })

const shown = (
  tasks: TaskRow[],
  tabs: Record<string, unknown[]>,
  selected: string | null = null,
  settled = true,
  keep: string | null = null,
) => {
  const { rows } = railRows({ tasks, remote: [], machines: [], sort: "default", query: "" })
  return dropIdleMains(rows, tabs, selected, settled, keep).map((r) => r.id)
}

describe("idle main rows in the rail", () => {
  test("routine runs stay off the rail, so a project with only those and an idle main row is not listed", () => {
    expect(shown([main, run], { shop: [] })).toEqual([])
  })

  test("the main row stays while it has a tab open or is selected", () => {
    expect(shown([main, run], { shop: [{}] })).toContain("shop")
    expect(shown([main, run], { shop: [] }, "shop")).toContain("shop")
  })

  test("a project with its own task lists the header and that task, not the idle main row", () => {
    expect(shown([main, task("feature"), run], { shop: [] })).toEqual(["project:/r/shop", "feature"])
  })

  test("a main row with a tab still heads the project's tasks", () => {
    expect(shown([main, task("feature")], { shop: [{}] })).toEqual(["project:/r/shop", "shop", "feature"])
  })

  test("a main row with a child task keeps its row, so the child is never orphaned", () => {
    const child = task("child", { parentTaskId: "shop" })
    expect(shown([main, child], { shop: [] })).toEqual(["project:/r/shop", "shop", "child"])
  })

  test("a project with nothing but an idle main row is not listed", () => {
    expect(shown([main], { shop: [] })).toEqual([])
  })

  test("only the idle project loses its main row; the next project is untouched", () => {
    const other = task("other", { kind: "main", repo: "/r/other" })
    const otherTask = task("fix", { repo: "/r/other" })
    expect(shown([main, task("feature"), other, otherTask], { shop: [], other: [{}] })).toEqual([
      "project:/r/shop",
      "feature",
      "project:/r/other",
      "other",
      "fix",
    ])
  })

  test("a main whose tabs are not known yet is not told apart from one with none until the sweep lands", () => {
    // Unsettled: unknown hides too, so a row never shows and then vanishes.
    expect(shown([main, task("feature")], {}, null, false)).toEqual(["project:/r/shop", "feature"])
    // Settled: unknown means the read failed, so the row stays.
    expect(shown([main, task("feature")], {}, null, true)).toEqual(["project:/r/shop", "shop", "feature"])
  })

  test("the main being reordered stays listed so j/k have a row to drag", () => {
    expect(shown([main, task("feature")], { shop: [] }, null, true, "shop")).toEqual([
      "project:/r/shop",
      "shop",
      "feature",
    ])
  })
})
