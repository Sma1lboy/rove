import { expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { dragSteps, dropMove, dropSteps, opensProject, previewDrop } from "../src/rail-blocks.ts"
import { type NavRow, groupByProject } from "../src/rail.ts"

const task = (id: string, repo: string, order: number, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo, kind: "task", branch: id, rank: 1, order, ...extra }) as TaskRow

const mainA = task("mainA", "/a", 0, { kind: "main" })
const mainB = task("mainB", "/b", 1, { kind: "main" })
const mainC = task("mainC", "/c", 2, { kind: "main" })
const a1 = task("a1", "/a", 3)
const b1 = task("b1", "/b", 4)
const a2 = task("a2", "/a", 5)
const a3 = task("a3", "/a", 6)
const pinned = task("ap", "/a", 7, { pinned: true })
const tasks = [a3, mainC, a1, pinned, mainA, b1, a2, mainB]

test("a drop counts places among the rows the daemon moves together", () => {
  expect(dragSteps(tasks, mainC, mainA)).toBe(-2)
  expect(dragSteps(tasks, a1, a3)).toBe(2)
  expect(dragSteps(tasks, a3, a2)).toBe(-1)
})

test("a drop across projects, pins or kinds is refused", () => {
  expect(dragSteps(tasks, a1, b1)).toBeNull()
  expect(dragSteps(tasks, a1, pinned)).toBeNull()
  expect(dragSteps(tasks, a1, mainA)).toBeNull()
  expect(dragSteps(tasks, a1, a1)).toBeNull()
})

test("a drop lands right above or below the row it was let go on", () => {
  expect(dropSteps(tasks, a1, a3, "below")).toBe(2)
  expect(dropSteps(tasks, a1, a3, "above")).toBe(1)
  expect(dropSteps(tasks, a3, a1, "above")).toBe(-2)
  expect(dropSteps(tasks, a3, a1, "below")).toBe(-1)
})

test("the preview moves a row with every child task nested under it", () => {
  const row = (id: string, kind: NavRow["kind"], depth = 1) => ({ id, kind, depth }) as NavRow
  const rows = [
    row("A", "project", 0),
    row("a1", "task"),
    row("a1-kid", "task", 2),
    row("a1-grandkid", "task", 3),
    row("a2", "task"),
    row("B", "project", 0),
    row("b1", "task"),
  ]
  const ids = (out: readonly NavRow[]) => out.map((r) => r.id)
  expect(ids(previewDrop(rows, "a1", "a2", "below"))).toEqual(["A", "a2", "a1", "a1-kid", "a1-grandkid", "B", "b1"])
  expect(ids(previewDrop(rows, "B", "A", "above"))).toEqual(["B", "b1", "A", "a1", "a1-kid", "a1-grandkid", "a2"])
  expect(ids(previewDrop(rows, "A", "B", "below"))).toEqual(["B", "b1", "A", "a1", "a1-kid", "a1-grandkid", "a2"])
})

test("pinned tasks follow the project's main row in every sort, keeping their own order", () => {
  const at = (iso: string) => ({ createdAt: iso })
  const list = [
    task("x1", "/x", 1, at("2026-01-04T00:00:00Z")),
    task("xp1", "/x", 2, { pinned: true, ...at("2026-01-01T00:00:00Z") }),
    task("x2", "/x", 3, at("2026-01-05T00:00:00Z")),
    task("xp2", "/x", 4, { pinned: true, ...at("2026-01-02T00:00:00Z") }),
    task("xm", "/x", 5, { kind: "main" }),
  ]
  const ids = (sort: "default" | "recent") => groupByProject(list, sort)[0]?.tasks.map((t) => t.id)
  expect(ids("default")).toEqual(["xm", "xp1", "xp2", "x1", "x2"])
  expect(ids("recent")).toEqual(["xm", "xp2", "xp1", "x2", "x1"])
})

test("a drop among the pinned rows or at the top of the project pins; one among the rest unpins", () => {
  const m = task("m", "/p", 0, { kind: "main" })
  const p = task("p", "/p", 1, { pinned: true })
  const t1 = task("t1", "/p", 2)
  const t2 = task("t2", "/p", 3)
  const t3 = task("t3", "/p", 4)
  const list = [m, p, t1, t2, t3]
  expect(dropMove(list, t3, p, "below", false)).toEqual({ pin: true, steps: 0 })
  expect(dropMove(list, t3, p, "above", true)).toEqual({ pin: true, steps: -1 })
  expect(dropMove(list, p, t2, "above", false)).toEqual({ pin: false, steps: 1 })
  // No pinned task yet: the top of the project pins, and the task is the whole pinned section.
  expect(dropMove([m, t1, t2, t3], t3, t1, "above", true)).toEqual({ pin: true, steps: 0 })
  expect(dropMove(list, t1, t3, "below", false)).toEqual({ steps: 2 })
  expect(dropMove(list, t1, task("q", "/q", 5), "above", true)).toBeNull()
})

test("the top of a project is the first task under its header, its main row and the main's children", () => {
  const row = (id: string, kind: NavRow["kind"] = "task", depth = 1, taskKind = "task") =>
    ({ id, kind, depth, task: { id, kind: taskKind } }) as NavRow
  const rows = [row("P", "project", 0), row("main", "task", 1, "main"), row("kid", "task", 2), row("a"), row("b")]
  expect(opensProject(rows, "b", "a")).toBe(true)
  expect(opensProject(rows, "a", "b")).toBe(true)
  expect(opensProject([...rows, row("c")], "c", "b")).toBe(false)
})
