import { describe, expect, test } from "vitest"
import { agentTreePrefix, buildAgentTree, shortGroupId } from "../../src/tui/multiagent/tree-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    archived: false,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...over,
  }
}

describe("agent tree projection", () => {
  test("uses dispatcher edges and inserts one round for fan-out siblings", () => {
    const owner = task("owner")
    const a = task("a", { dispatcher: { taskId: "owner", tabId: "tab-1" }, groupId: "01ROUNDALPHA" })
    const b = task("b", { dispatcher: { taskId: "owner", tabId: "tab-1" }, groupId: "01ROUNDALPHA" })
    const direct = task("direct", { dispatcher: { taskId: "owner", tabId: "tab-2" } })
    const nested = task("nested", { dispatcher: { taskId: "a", tabId: "tab-3" } })

    const tree = buildAgentTree([owner, a, b, direct, nested])

    expect(tree.rows.map((row) => `${row.kind}:${row.kind === "task" ? row.task.id : row.groupId}`)).toEqual([
      "task:owner",
      "round:01ROUNDALPHA",
      "task:a",
      "task:nested",
      "task:b",
      "task:direct",
    ])
    expect(tree.summary).toEqual({ owners: 1, agents: 4, rounds: 1, anomalies: 0 })
    expect(tree.rows.find((row) => row.kind === "task" && row.task.id === "nested")?.depth).toBe(3)
  })

  test("surfaces missing parents and breaks corrupt cycles", () => {
    const orphan = task("orphan", { dispatcher: { taskId: "gone", tabId: "tab-1" } })
    const a = task("a", { dispatcher: { taskId: "b", tabId: "tab-1" } })
    const b = task("b", { dispatcher: { taskId: "a", tabId: "tab-1" } })
    const self = task("self", { dispatcher: { taskId: "self", tabId: "tab-1" } })

    const tree = buildAgentTree([orphan, a, b, self])
    const taskRows = tree.rows.filter((row) => row.kind === "task")

    expect(taskRows).toHaveLength(4)
    expect(taskRows.find((row) => row.task.id === "orphan")?.anomaly).toBe("orphan")
    expect(taskRows.find((row) => row.task.id === "self")?.anomaly).toBe("cycle")
    expect(taskRows.some((row) => row.anomaly === "cycle" && (row.task.id === "a" || row.task.id === "b"))).toBe(true)
    expect(tree.summary.anomalies).toBe(3)
  })

  test("renders stable branch prefixes and compact round ids", () => {
    const owner = task("owner")
    const child = task("child", { dispatcher: { taskId: "owner", tabId: "tab-1" } })
    const rows = buildAgentTree([owner, child]).rows

    expect(agentTreePrefix(rows[0]!)).toBe("")
    expect(agentTreePrefix(rows[1]!)).toBe("└─ ")
    expect(shortGroupId("01ABCDEFGHIJK")).toBe("DEFGHIJK")
  })
})
