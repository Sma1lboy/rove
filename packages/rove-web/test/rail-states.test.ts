import { describe, expect, test } from "bun:test"
import type { RowStatus, TaskRow } from "rove-bridge/protocol"
import { RAIL_STATES, railStateRows, stateOf } from "../src/rail-states.ts"
import { foldProjects } from "../src/rail.ts"

const status = (kind: RowStatus["kind"]): RowStatus => ({ kind, since: 0 })
const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, label: id, repo: "/r/app", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const input = (tasks: TaskRow[], query = "") => ({
  tasks,
  remote: [],
  machines: [],
  sort: "default" as const,
  query,
})
/** Each header, then the ids of the task rows under it. */
const outline = (tasks: TaskRow[]) =>
  railStateRows(input(tasks)).rows.map((row) =>
    row.kind === "state" ? row.state : row.kind === "task" ? row.id : row.kind,
  )

describe("the by-state rail", () => {
  test("a task is listed by what its row's mark says, then by the daemon's group and its PR", () => {
    expect(stateOf(task("a", { rowStatus: status("unseen") }))).toBe("needs")
    expect(stateOf(task("b", { rowStatus: status("running") }))).toBe("working")
    expect(stateOf(task("c", { rowStatus: status("idle"), group: "ready-for-review" }))).toBe("ready")
    expect(stateOf(task("d", { rowStatus: status("idle"), group: "waiting-on-you" }))).toBe("needs")
    expect(stateOf(task("e", { group: "idle", pr: { lifecycle: "open", checkState: "none" } }))).toBe("ready")
    expect(stateOf(task("f", { group: "unknown" }))).toBe("idle")
  })

  test("projects share one list; empty states have no header and the rest run needs → working → ready → idle", () => {
    expect(
      outline([
        task("i", { repo: "/r/one" }),
        task("w", { repo: "/r/two", rowStatus: status("running") }),
        task("n", { repo: "/r/three", rowStatus: status("needs-input") }),
      ]),
    ).toEqual(["needs", "n", "working", "w", "idle", "i"])
    expect(RAIL_STATES).toEqual(["needs", "working", "ready", "idle"])
  })

  test("a parent takes its subtree's most urgent state and keeps its children under it", () => {
    expect(
      outline([
        task("p"),
        task("c1", { parentTaskId: "p", rowStatus: status("running") }),
        task("g", { parentTaskId: "c1", rowStatus: status("attention") }),
        task("other", { rowStatus: status("running") }),
      ]),
    ).toEqual(["needs", "p", "c1", "g", "working", "other"])
  })

  test("the attempts of a compare round stay one block, in the round's most urgent state", () => {
    const attempt = (id: string, extra: Partial<TaskRow>) =>
      task(id, { groupId: "g1", createdAt: `2026-11-06T00:00:0${id.slice(-1)}Z`, ...extra })
    const rows = railStateRows(
      input([
        attempt("a1", { rowStatus: status("idle") }),
        task("solo", { rowStatus: status("running") }),
        attempt("a2", { rowStatus: status("needs-input") }),
      ]),
    ).rows
    expect(
      rows.map((row) => (row.kind === "state" ? row.state : row.id.startsWith("round:") ? "round" : row.id)),
    ).toEqual(["needs", "round", "a1", "a2", "working", "solo"])
  })

  test("a header counts its tasks even folded, and folding it hides them", () => {
    const rows = railStateRows(
      input([task("a", { rowStatus: status("running") }), task("b", { rowStatus: status("running") })]),
    ).rows
    const head = rows[0]
    expect(head?.kind === "state" && head.count).toBe(2)
    expect(foldProjects(rows, new Set(["state:working"])).map((row) => row.id)).toEqual(["state:working"])
  })
})
