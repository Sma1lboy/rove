import { expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { dragSteps, dropSteps, dropsOn, previewDrop } from "../src/rail-blocks.ts"
import { type NavRow, groupByProject } from "../src/rail.ts"

const task = (id: string, repo: string, order: number, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, label: id, repo, kind: "task", branch: id, rank: 1, order, ...extra }) as TaskRow

const a1 = task("a1", "/a", 3)
const b1 = task("b1", "/b", 4)
const a2 = task("a2", "/a", 5)
const a3 = task("a3", "/a", 6)
const pinned = task("ap", "/a", 7, { pinned: true })
const tasks = [a3, a1, pinned, b1, a2]

test("a drop counts places among the rows the daemon moves together", () => {
  expect(dragSteps(tasks, a1, a3)).toBe(2)
  expect(dragSteps(tasks, a3, a2)).toBe(-1)
})

test("a drop across projects or pins is refused", () => {
  expect(dragSteps(tasks, a1, b1)).toBeNull()
  expect(dragSteps(tasks, a1, pinned)).toBeNull()
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

test("pinned tasks head their project in every sort, keeping their own order", () => {
  const at = (iso: string) => ({ createdAt: iso })
  const list = [
    task("x1", "/x", 1, at("2026-01-04T00:00:00Z")),
    task("xp1", "/x", 2, { pinned: true, ...at("2026-01-01T00:00:00Z") }),
    task("x2", "/x", 3, at("2026-01-05T00:00:00Z")),
    task("xp2", "/x", 4, { pinned: true, ...at("2026-01-02T00:00:00Z") }),
  ]
  const ids = (sort: "default" | "recent") => groupByProject(list, sort)[0]?.tasks.map((t) => t.id)
  expect(ids("default")).toEqual(["xp1", "xp2", "x1", "x2"])
  expect(ids("recent")).toEqual(["xp2", "xp1", "x2", "x1"])
})

test("a drag stays among the tasks with its pin: it never pins or unpins", () => {
  const p = task("p", "/p", 1, { pinned: true })
  const t1 = task("t1", "/p", 2)
  expect(dropsOn(t1, p)).toBe(false)
  expect(dropsOn(p, t1)).toBe(false)
  expect(dropsOn(t1, task("t2", "/p", 3))).toBe(true)
})
