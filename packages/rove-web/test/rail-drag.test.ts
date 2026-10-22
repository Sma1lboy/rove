import { expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { dragSteps } from "../src/rail.ts"

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
