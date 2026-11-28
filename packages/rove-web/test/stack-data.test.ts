import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { bottomUnmerged, stackOf } from "../src/stack-data.ts"

const row = (id: string, o: Partial<TaskRow>): TaskRow =>
  ({ id, title: id, label: id, branch: `b-${id}`, ...o }) as TaskRow

describe("stacks", () => {
  const rows = [
    row("1", { baseRef: "main", pr: { lifecycle: "merged" } as TaskRow["pr"] }),
    row("2", { baseRef: "b-1" }),
    row("3", { baseRef: "b-2" }),
    row("solo", { baseRef: "main" }),
  ]
  test("a chain is found by each link's base branch, bottom first", () => {
    const s = stackOf(rows, rows[1] as TaskRow)
    expect(s?.path.map((n) => n.id)).toEqual(["1"])
    expect(s?.level.map((n) => n.id)).toEqual(["2"])
    expect(s?.kids.map((n) => n.id)).toEqual(["3"])
    expect(s?.base).toBe("main")
  })
  test("only the lowest unmerged link can land", () => {
    expect(bottomUnmerged(stackOf(rows, rows[2] as TaskRow) as never, "3")?.id).toBe("2")
  })
  test("a task cut from main alone is in no stack; a sha-based cut child hangs off its parent", () => {
    expect(stackOf(rows, rows[3] as TaskRow)).toBeNull()
    const cut = [row("p", {}), row("c", { baseRef: "abcdef1234", parentTaskId: "p" })]
    expect(stackOf(cut, cut[1] as TaskRow)?.path.map((n) => n.id)).toEqual(["p"])
  })
  test("children dispatched in parallel are one group of siblings, not a chain", () => {
    const fan = [
      row("p", {}),
      ...["a", "b", "c"].map((id, i) => row(id, { baseRef: "abcdef1234", parentTaskId: "p", createdAt: `${i}` })),
      row("g", { baseRef: "b-b", parentTaskId: "p" }),
    ]
    const fromParent = stackOf(fan, fan[0] as TaskRow)
    expect(fromParent?.level.map((n) => n.id)).toEqual(["p"])
    expect(fromParent?.kids.map((n) => n.id)).toEqual(["a", "b", "c"])
    const fromMiddle = stackOf(fan, fan[2] as TaskRow)
    expect(fromMiddle?.path.map((n) => n.id)).toEqual(["p"])
    expect(fromMiddle?.level.map((n) => n.id)).toEqual(["a", "b", "c"])
    expect(fromMiddle?.kids.map((n) => n.id)).toEqual(["g"])
    expect(stackOf(fan, fan[4] as TaskRow)?.path.map((n) => n.id)).toEqual(["p", "b"])
  })
})
