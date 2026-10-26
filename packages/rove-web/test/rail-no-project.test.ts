import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { groupByProject, navRows, railRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/app", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow

describe("the No project group", () => {
  const rows = [
    task("app-main", { kind: "main" }),
    task("shell", { kind: "dir", repo: "/Users/me", scratch: true }),
    task("fresh-run", { kind: "dir", repo: "/home/.rove/routines/a", noProject: true }),
    task("standing", { kind: "dir", repo: "/home/.rove/routines/b", noProject: true, routine: true }),
    // A plain dir task is still its own project.
    task("plain-dir", { kind: "dir", repo: "/r/plain" }),
  ]

  test("scratch and noProject dir tasks in different dirs land in one group above the projects", () => {
    const groups = groupByProject(rows)
    expect(groups.map((g) => g.key ?? g.repo)).toEqual(["~scratch", "/r/app", "/r/plain"])
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["shell", "fresh-run", "standing"])
  })

  test("a standing routine folds into the group's routines row; the header is project:~scratch", () => {
    const { rows: nav } = railRows({
      tasks: rows,
      remote: [],
      machines: [],
      sort: "default",
      query: "",
      routines: new Set(),
    })
    expect(nav.map((r) => r.id)).toEqual([
      "project:~scratch",
      "shell",
      "fresh-run",
      "~routines:~scratch",
      "project:/r/app",
      "app-main",
      "project:/r/plain",
      "plain-dir",
    ])
    expect(nav[0]).toMatchObject({ kind: "project", noProject: true })
  })

  test("an open fold lists the standing session", () => {
    const ids = navRows(groupByProject(rows), "", new Set(["~scratch"])).map((r) => r.id)
    expect(ids).toContain("standing")
  })
})
