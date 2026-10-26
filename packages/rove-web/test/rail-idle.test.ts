import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { dropIdleProjects } from "../src/rail-idle.ts"
import { railRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/shop", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const main = task("shop", { kind: "main" })
const run = task("daily-release", { routine: true })

const shown = (tasks: TaskRow[], tabs: Record<string, unknown[]>, selected: string | null = null) => {
  const { rows } = railRows({ tasks, remote: [], machines: [], sort: "default", query: "" })
  return dropIdleProjects(rows, tabs, selected, true).map((r) => r.id)
}

describe("idle projects in the rail", () => {
  test("routine runs stay off the rail, so a project with only those and an idle main row is not listed", () => {
    expect(shown([main, run], { shop: [] })).toEqual([])
  })

  test("the main row stays while it has a tab open or is selected", () => {
    expect(shown([main, run], { shop: [{}] })).toContain("shop")
    expect(shown([main, run], { shop: [] }, "shop")).toContain("shop")
  })

  test("a project with its own task keeps the main row beside it", () => {
    expect(shown([main, task("feature"), run], { shop: [] })).toEqual(["project:/r/shop", "shop", "feature"])
  })

  test("a project with nothing but an idle main row is not listed", () => {
    expect(shown([main], { shop: [] })).toEqual([])
  })
})
