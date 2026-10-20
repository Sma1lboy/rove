import { describe, expect, test } from "bun:test"
import type { TabRow, TaskRow } from "rove-bridge/protocol"
import { projectLabel, railRows } from "../src/rail.ts"

const task = (id: string, repo: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo, kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const onNarwhal = (id: string, repo: string, extra: Partial<TaskRow> = {}) =>
  task(id, repo, { machine: { id: "narwhal", label: "narwhal" }, ...extra })

const base = {
  sort: "default" as const,
  tabsOf: (id: string): readonly TabRow[] =>
    (id === "mine" ? [{ id: "tab-1", kind: "engine", title: null }] : []) as never,
  tabLabel: () => "tab",
  query: "",
  routines: new Set<string>(),
}
const machines = [{ alias: "narwhal", hostLabel: "narwhal" }]

describe("machine layer in the rail", () => {
  test("a machine's projects sit under its header after this Mac's, and remote tasks get no tab rows", () => {
    const { rows } = railRows({
      ...base,
      tasks: [task("mine", "/w/app")],
      remote: [onNarwhal("far", "/srv/app", { updatedAt: "2026-01-01" })],
      machines,
    })
    expect(rows.map((row) => [row.id, row.kind, "machine" in row ? row.machine : undefined])).toEqual([
      ["project:/w/app", "project", undefined],
      ["mine", "task", undefined],
      ["mine::tab-1", "tab", undefined],
      ["machine:narwhal", "machine", undefined],
      ["project:narwhal\0/srv/app", "project", "narwhal"],
      ["far", "task", "narwhal"],
    ])
  })

  test("a registered machine with no tasks keeps its header; rows of an unregistered one are dropped", () => {
    const { rows } = railRows({
      ...base,
      tasks: [],
      remote: [task("gone", "/x", { machine: { id: "removed", label: "removed" } })],
      machines,
    })
    expect(rows.map((row) => row.id)).toEqual(["machine:narwhal"])
  })

  test("a fold is keyed by machine, so the same path on two machines folds on its own", () => {
    const routine = { routine: true }
    const { rows } = railRows({
      ...base,
      tasks: [task("l", "/w/app", routine)],
      remote: [onNarwhal("r", "/w/app", routine)],
      machines,
      routines: new Set(["narwhal\0/w/app"]),
    })
    const folds = rows.filter((row) => row.kind === "routines")
    expect(folds.map((row) => [row.id, row.kind === "routines" && row.expanded])).toEqual([
      ["~routines:/w/app", false],
      ["~routines:narwhal\0/w/app", true],
    ])
  })

  test("the search prunes a machine's rows but its header stays", () => {
    const { rows } = railRows({
      ...base,
      tasks: [task("mine", "/w/app")],
      remote: [onNarwhal("far", "/srv/app")],
      machines,
      query: "zzz",
    })
    expect(rows.map((row) => row.id)).toEqual(["machine:narwhal"])
  })
})

describe("project labels across machines (TUI sidebarProjectLabel)", () => {
  test("a name shared only with another machine reads host:name; this Mac keeps the bare name", () => {
    const repos = [
      { repo: "/w/rove", host: "" },
      { repo: "/srv/rove", host: "narwhal" },
    ]
    expect(projectLabel("/w/rove", repos, "")).toBe("rove")
    expect(projectLabel("/srv/rove", repos, "narwhal")).toBe("narwhal:rove")
  })

  test("two checkouts on one machine take the path tail; a tail that repeats elsewhere gets the host too", () => {
    const same = [
      { repo: "/a/rove", host: "" },
      { repo: "/b/rove", host: "" },
    ]
    expect(projectLabel("/a/rove", same, "")).toBe("a/rove")
    const repeats = [
      { repo: "/a/rove", host: "narwhal" },
      { repo: "/b/rove", host: "narwhal" },
      { repo: "/a/rove", host: "" },
    ]
    expect(projectLabel("/a/rove", repeats, "narwhal")).toBe("narwhal:a/rove")
    expect(projectLabel("/b/rove", repeats, "narwhal")).toBe("b/rove")
  })
})
