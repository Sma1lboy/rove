import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { groupByState, reasonKey, tasksOfMachine } from "../src/machines-overview.ts"

const task = (id: string, over: Partial<TaskRow> = {}): TaskRow =>
  ({ id, label: id, machine: { id: "mac", label: "Mac" }, pr: null, status: "backlog", ...over }) as TaskRow

describe("machines overview", () => {
  test("a machine's tasks are the feed rows stamped with it, minus routine runs and tasks being deleted", () => {
    const rows = [
      task("a"),
      task("b", { machine: { id: "other", label: "Other" } }),
      task("c", { routine: true }),
      task("d", { deleting: true }),
      task("e", { machine: undefined }),
    ]
    expect(tasksOfMachine(rows, "mac").map((r) => r.id)).toEqual(["a"])
  })

  test("tasks group by the rail's states, most urgent first, empty states left out", () => {
    const rows = [
      task("idle"),
      task("busy", { rowStatus: { kind: "busy" } as TaskRow["rowStatus"] }),
      task("ask", { rowStatus: { kind: "needs-input" } as TaskRow["rowStatus"] }),
      task("pr", { pr: { lifecycle: "open", checkState: "passing" } }),
    ]
    expect(groupByState(rows).map((g) => [g.state, g.tasks.map((r) => r.id)])).toEqual([
      ["needs", ["ask"]],
      ["working", ["busy"]],
      ["ready", ["pr"]],
      ["idle", ["idle"]],
    ])
    expect(groupByState([])).toEqual([])
  })

  test("a failure reason has a sentence only when the page knows it", () => {
    expect(reasonKey("host-key-changed")).toBe("machines.reason.host-key-changed")
    expect(reasonKey("something-new")).toBeNull()
    expect(reasonKey(null)).toBeNull()
    expect(reasonKey(undefined)).toBeNull()
  })
})
