import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { railRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({
    id,
    title: id,
    label: id,
    repo: "/r/app",
    kind: "task",
    branch: `b/${id}`,
    rank: 1,
    status: "in_progress",
    ...extra,
  }) as TaskRow

const rail = (tasks: TaskRow[], extra: { sort?: "name" | "default"; query?: string } = {}) =>
  railRows({ tasks, remote: [], machines: [], sort: extra.sort ?? "default", query: extra.query ?? "" }).rows.flatMap(
    (row) => (row.kind === "task" ? [row.task.id] : []),
  )

describe("a row is named by the bridge's label", () => {
  // The stored title is the prompt's first words; the label is the engine's conversation name.
  const rows = [
    task("a", { title: "zzz first words", label: "Alpha chat" }),
    task("b", { title: "aaa first words", label: "Zulu chat" }),
  ]

  test("sort by name orders by the label, not the stored title", () => {
    expect(rail(rows, { sort: "name" })).toEqual(["a", "b"])
  })

  test("search finds a row by its label and still by its stored title", () => {
    expect(rail(rows, { query: "zulu" })).toEqual(["b"])
    expect(rail(rows, { query: "zzz first" })).toEqual(["a"])
  })
})
