import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { groupByProject, railRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, label: id, repo: "/r/app", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow

describe("the Ungrouped group", () => {
  const rows = [
    task("app-checkout", { kind: "dir" }),
    task("shell", { kind: "dir", repo: "/Users/me", noProject: true }),
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

  test("the header is project:~scratch, and a standing routine run stays off the rail", () => {
    const { rows: nav } = railRows({ tasks: rows, remote: [], machines: [], sort: "default", query: "" })
    expect(nav.map((r) => r.id)).toEqual([
      "project:~scratch",
      "shell",
      "fresh-run",
      "project:/r/app",
      "app-checkout",
      "project:/r/plain",
      "plain-dir",
    ])
    expect(nav[0]).toMatchObject({ kind: "project", noProject: true })
  })
})

const connectorRows = [
  task("wechat", { kind: "dir", repo: "/home/.rove/weixin/agent", connector: "weixin", rank: 0 }),
  task("old", { repo: "/r/old", rank: 1 }),
  task("shell", { kind: "dir", repo: "/Users/me", noProject: true, rank: 2 }),
  task("new", { repo: "/r/new", rank: 3 }),
]

test.each([
  ["default", ["project:/r/old", "project:/r/new"]],
  ["name", ["project:/r/new", "project:/r/old"]],
] as const)("a chat connector's project sinks below every other project (%s sort)", (sort, projects) => {
  const { rows: nav } = railRows({ tasks: connectorRows, remote: [], machines: [], sort, query: "" })
  expect(nav.filter((r) => r.kind === "project").map((r) => r.id)).toEqual([
    "project:~scratch",
    ...projects,
    "project:/home/.rove/weixin/agent",
  ])
})

test("a built-in chat connector's project is named by its app; a plugin's keeps its folder", () => {
  const rows = [
    task("wechat", { kind: "dir", repo: "/home/.rove/weixin/agent", connector: "weixin" }),
    task("bot", { kind: "dir", repo: "/home/acme-bot", connector: "acme" }),
  ]
  const { rows: nav } = railRows({ tasks: rows, remote: [], machines: [], sort: "default", query: "" })
  expect(nav.filter((r) => r.kind === "project").map((r) => r.label)).toEqual(["WeChat", "acme-bot"])
})
