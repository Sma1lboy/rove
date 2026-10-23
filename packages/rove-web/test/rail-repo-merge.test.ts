import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { railRows } from "../src/rail.ts"

const task = (id: string, repo: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo, kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const on =
  (machine: string) =>
  (id: string, repo: string, extra: Partial<TaskRow> = {}) =>
    task(id, repo, { machine: { id: machine, label: machine }, ...extra })
const onNarwhal = on("narwhal")
const onMac = on("mac")

const base = {
  sort: "default" as const,
  query: "",
  routines: new Set<string>(),
}
const machines = [
  { alias: "narwhal", hostLabel: "narwhal" },
  { alias: "mac", hostLabel: "mac" },
]
const rove = { repoId: "github.com/me/rove" }
const heads = (rows: ReturnType<typeof railRows>["rows"]) => rows.filter((row) => row.kind === "project")

describe("one project per repo across machines", () => {
  test("the same repo here and on another machine is ONE header; each row keeps its own machine", () => {
    const { rows, groups } = railRows({
      ...base,
      tasks: [task("main", "/w/rove", { ...rove, kind: "main" }), task("mine", "/w/rove", rove)],
      remote: [onNarwhal("far", "/srv/code/rove", rove)],
      machines,
    })
    expect(rows.map((row) => [row.id, row.kind, row.machine])).toEqual([
      ["project:github.com/me/rove", "project", undefined],
      ["main", "task", undefined],
      ["mine", "task", undefined],
      ["far", "task", "narwhal"],
    ])
    // Project actions use this machine's checkout; the header names no machine (the remote row's cloud does).
    expect(heads(rows)).toEqual([{ id: "project:github.com/me/rove", kind: "project", repo: "/w/rove", label: "rove" }])
    expect(groups.map((group) => [group.repo, group.label])).toEqual([["/w/rove", "rove"]])
  })

  test("a repo only on other machines heads with the first machine's checkout and routes there", () => {
    const { rows } = railRows({
      ...base,
      tasks: [],
      remote: [onMac("b", "/home/rove", rove), onNarwhal("a", "/srv/rove", rove)],
      machines,
    })
    expect(heads(rows)).toEqual([
      {
        id: "project:github.com/me/rove",
        kind: "project",
        repo: "/srv/rove",
        label: "rove",
        machine: "narwhal",
      },
    ])
    expect(rows.slice(1).map((row) => [row.id, row.machine])).toEqual([
      ["a", "narwhal"],
      ["b", "mac"],
    ])
  })

  test("a merged project's routine fold is keyed by the repo id and holds every machine's sessions", () => {
    const { rows } = railRows({
      ...base,
      tasks: [task("l", "/w/rove", { ...rove, routine: true })],
      remote: [onNarwhal("r", "/srv/rove", { ...rove, routine: true })],
      machines,
      routines: new Set(["github.com/me/rove"]),
    })
    expect(rows.map((row) => [row.id, row.machine])).toEqual([
      ["project:github.com/me/rove", undefined],
      ["~routines:github.com/me/rove", undefined],
      ["l", undefined],
      ["r", "narwhal"],
    ])
  })

  test("two different repos with one basename are two headers, told apart by owner/name", () => {
    const { rows } = railRows({
      ...base,
      tasks: [task("mine", "/w/rove", rove)],
      remote: [onNarwhal("fork", "/srv/rove", { repoId: "github.com/other/rove" })],
      machines,
    })
    expect(heads(rows).map((row) => [row.id, row.kind === "project" && row.label])).toEqual([
      ["project:github.com/me/rove", "me/rove"],
      ["project:github.com/other/rove", "other/rove"],
    ])
  })

  test("rows without a repo id keep one header per machine and path, neither naming a machine", () => {
    const { rows } = railRows({
      ...base,
      tasks: [task("mine", "/w/app")],
      remote: [onNarwhal("far", "/w/app")],
      machines,
    })
    expect(heads(rows).map((row) => [row.id, row.kind === "project" && row.label, row.machine])).toEqual([
      ["project:/w/app", "app", undefined],
      ["project:narwhal\0/w/app", "app", "narwhal"],
    ])
  })

  test("name sort orders merged projects by label; recent by their newest task on any machine", () => {
    const input = {
      ...base,
      tasks: [task("z", "/w/zeta", { repoId: "github.com/me/zeta", updatedAt: "2026-01-01" })],
      remote: [
        onNarwhal("a", "/srv/alpha", { repoId: "github.com/me/alpha", updatedAt: "2026-02-01" }),
        onNarwhal("z2", "/srv/zeta", { repoId: "github.com/me/zeta", updatedAt: "2026-03-01" }),
      ],
      machines,
    }
    expect(railRows({ ...input, sort: "name" }).rows.map((row) => row.id)).toEqual([
      "project:github.com/me/alpha",
      "a",
      "project:github.com/me/zeta",
      "z",
      "z2",
    ])
    expect(railRows({ ...input, sort: "recent" }).rows.map((row) => row.id)).toEqual([
      "project:github.com/me/zeta",
      "z2",
      "z",
      "project:github.com/me/alpha",
      "a",
    ])
  })
})
