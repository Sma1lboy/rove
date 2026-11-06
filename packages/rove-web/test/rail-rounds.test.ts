import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { treeGuides } from "../src/rail-blocks.ts"
import { groupByProject, navRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, label: id, repo: "/r/app", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const attempt = (id: string, engine: string, extra: Partial<TaskRow> = {}): TaskRow =>
  task(id, {
    groupId: "g1",
    label: "Fix login #1/3",
    engine: { id: engine.toLowerCase(), name: engine },
    createdAt: `2026-11-06T00:00:0${id.slice(-1)}Z`,
    ...extra,
  })
const shape = (tasks: TaskRow[], sort: "default" | "recent" = "default") =>
  navRows(groupByProject(tasks, sort)).flatMap((row) =>
    row.kind === "round"
      ? [[row.kind, row.title, row.depth, row.tasks.length]]
      : row.kind === "task"
        ? [[row.id, row.depth, row.attempt]]
        : [],
  )

describe("a parallel round in the rail", () => {
  test("its attempts nest under one header, labelled by engine, and keep their own children", () => {
    expect(
      shape([
        task("before"),
        attempt("a1", "Claude"),
        attempt("a2", "Codex"),
        attempt("a3", "Codex"),
        task("kid", { parentTaskId: "a2" }),
        task("after"),
      ]),
    ).toEqual([
      ["before", 1, undefined],
      ["round", "Fix login", 1, 3],
      ["a1", 2, "Claude"],
      ["a2", 2, "Codex #1"],
      ["kid", 3, undefined],
      ["a3", 2, "Codex #2"],
      ["after", 1, undefined],
    ])
  })

  test("attempts scattered by the sort gather under the header at the first one's place", () => {
    const rows = shape(
      [
        attempt("a1", "Claude", { createdAt: "2026-11-06T00:00:01Z" }),
        task("mid", { createdAt: "2026-11-06T00:00:05Z" }),
        attempt("a2", "Codex", { createdAt: "2026-11-06T00:00:09Z" }),
      ],
      "recent",
    )
    expect(rows.map((row) => row[0])).toEqual(["round", "a2", "a1", "mid"])
  })

  test("one live attempt left (the others archived) is a plain row", () => {
    expect(shape([attempt("a1", "Claude", { kept: true }), task("other")])).toEqual([
      ["a1", 1, undefined],
      ["other", 1, undefined],
    ])
  })

  test("a round never joins attempts of different parents, and its guides hook the last attempt", () => {
    const nav = navRows(
      groupByProject([
        task("p1"),
        task("p2"),
        attempt("a1", "Claude", { parentTaskId: "p1" }),
        attempt("a2", "Codex", { parentTaskId: "p2" }),
        attempt("a3", "Codex", { parentTaskId: "p2" }),
      ]),
    )
    const header = nav.findIndex((row) => row.kind === "round")
    expect(nav.filter((row) => row.kind === "round")).toHaveLength(1)
    expect(nav.slice(header - 1, header + 3).map((row) => row.id)).toEqual(["p2", "round::g1", "a2", "a3"])
    expect(treeGuides(nav, header)).toEqual(["elbow"])
    expect(treeGuides(nav, header + 2)).toEqual(["blank", "elbow"])
  })
})
