import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { dropIdleProjects } from "../src/rail-idle.ts"
import { groupByProject, navRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/shop", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const main = task("shop", { kind: "main" })
const run = task("daily-release", { routine: true })

const shown = (tasks: TaskRow[], tabs: Record<string, unknown[]>, selected: string | null = null) =>
  dropIdleProjects(navRows(groupByProject(tasks), "", new Set(["/r/shop"])), tabs, selected, true).map((r) => r.id)

describe("idle projects in the rail", () => {
  test("a project with only routine runs lists them without its idle main row", () => {
    expect(shown([main, run], { shop: [] })).toEqual(["project:/r/shop", "~routines:/r/shop", "daily-release"])
  })

  test("the main row stays while it has a tab open or is selected", () => {
    expect(shown([main, run], { shop: [{}] })).toContain("shop")
    expect(shown([main, run], { shop: [] }, "shop")).toContain("shop")
  })

  test("a project with its own task keeps the main row beside it", () => {
    expect(shown([main, task("feature"), run], { shop: [] })).toContain("shop")
  })

  test("a project with nothing but an idle main row is not listed", () => {
    expect(shown([main], { shop: [] })).toEqual([])
  })
})
