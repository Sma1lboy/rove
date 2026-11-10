import { expect, test } from "bun:test"
import type { TaskRow, TasksPayload } from "../src/protocol.ts"
import { applyTasksPatch, diffPayload, indexPayload } from "../src/tasks-patch.ts"

const row = (id: string, more: Record<string, unknown> = {}) => ({ id, title: id, ...more }) as unknown as TaskRow
const list = (tasks: TaskRow[], archived: TaskRow[] = [], attention: unknown[] = []) =>
  ({ rev: 1, tasks, archived, attention, gates: [] }) as unknown as TasksPayload
const patchOf = (a: TasksPayload, b: TasksPayload) => diffPayload(indexPayload(a), indexPayload(b), b, a.rev ?? 0)

test("one changed row among many is the whole patch, and applying it gives the new list", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(`t${i}`))
  const before = list(rows)
  const after = list(rows.map((r) => (r.id === "t500" ? row("t500", { title: "renamed" }) : r)))
  const patch = patchOf(before, after)
  expect(patch?.tasks).toEqual({ upsert: [row("t500", { title: "renamed" })], remove: [] })
  expect(applyTasksPatch(before, patch as never).tasks).toEqual(after.tasks)
})

test("adds, removes, moves, an archive and an inbox change all survive the round trip", () => {
  const before = list([row("a"), row("b"), row("c")], [row("z")])
  const after = list(
    [row("c"), row("a", { pinned: true }), row("d")],
    [row("z"), row("b", { archived: true })],
    [{ id: "n1" }],
  )
  const patch = patchOf(before, after)
  expect(patch?.tasks?.order).toEqual(["c", "a", "d"])
  const applied = applyTasksPatch(before, patch as never)
  expect(applied).toEqual({ ...after, rev: 2 })
})

test("a clock that only ticked is no change", () => {
  const at = (forMs: number) => list([row("a", { activity: { state: "running", since: 5, forMs } })])
  expect(patchOf(at(100), at(900))).toBeNull()
})
