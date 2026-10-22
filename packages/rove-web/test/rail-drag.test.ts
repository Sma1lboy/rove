import { expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { type NavRow, dragSteps, dropSteps, previewDrop } from "../src/rail.ts"

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

test("the preview moves a row with everything nested under it", () => {
  const row = (id: string, kind: NavRow["kind"]) => ({ id, kind }) as NavRow
  const rows = [
    row("A", "project"),
    row("a1", "task"),
    row("a1::tab-1", "tab"),
    row("a2", "task"),
    row("B", "project"),
    row("b1", "task"),
  ]
  const ids = (out: readonly NavRow[]) => out.map((r) => r.id)
  expect(ids(previewDrop(rows, "a1", "a2", "below"))).toEqual(["A", "a2", "a1", "a1::tab-1", "B", "b1"])
  expect(ids(previewDrop(rows, "B", "A", "above"))).toEqual(["B", "b1", "A", "a1", "a1::tab-1", "a2"])
  expect(ids(previewDrop(rows, "A", "B", "below"))).toEqual(["B", "b1", "A", "a1", "a1::tab-1", "a2"])
})
