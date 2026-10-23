import { describe, expect, test } from "bun:test"
import type { RowStatus, TaskRow } from "rove-bridge/protocol"
import { mostUrgentStatus } from "../src/rail-glyphs.ts"
import { childMarkerOf, groupByProject, navRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/app", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const rows = (tasks: TaskRow[]) => navRows(groupByProject(tasks))
const shape = (tasks: TaskRow[]) =>
  rows(tasks).flatMap((row) => (row.kind === "task" ? [[row.id, row.depth, row.level]] : []))

describe("child tasks in the rail", () => {
  test("a child nests under its parent, one indent level per generation, in stored order", () => {
    expect(
      shape([
        task("p"),
        task("c1", { parentTaskId: "p" }),
        task("c2", { parentTaskId: "p" }),
        task("g", { parentTaskId: "c1" }),
        task("other"),
      ]),
    ).toEqual([
      ["p", 1, undefined],
      ["c1", 2, undefined],
      ["g", 3, undefined],
      ["c2", 2, undefined],
      ["other", 1, undefined],
    ])
  })

  test("the indent stops at three levels; a deeper row wears its real level", () => {
    const chain = [task("a"), task("b", { parentTaskId: "a" }), task("c", { parentTaskId: "b" })]
    chain.push(task("d", { parentTaskId: "c" }), task("e", { parentTaskId: "d" }))
    expect(shape(chain).map(([id, depth, level]) => [id, depth, level])).toEqual([
      ["a", 1, undefined],
      ["b", 2, undefined],
      ["c", 3, undefined],
      ["d", 3, 4],
      ["e", 3, 5],
    ])
  })

  test("a child whose parent is not on screen stays top level, and a lineage loop cannot hide rows", () => {
    expect(shape([task("kid", { parentTaskId: "gone" })])).toEqual([["kid", 1, undefined]])
    expect(shape([task("x", { parentTaskId: "y" }), task("y", { parentTaskId: "x" })])).toEqual([
      ["x", 1, undefined],
      ["y", 1, undefined],
    ])
  })

  test("a child nests under a parent in another project; a routine session never nests", () => {
    const elsewhere = task("parent", { repo: "/r/other" })
    const ids = rows([
      task("kid", { parentTaskId: "parent" }),
      elsewhere,
      task("sched", { routine: true, parentTaskId: "parent" }),
    ]).map((row) => row.id)
    // The child's own project has nothing else to draw but the routine fold; the child sits under its parent.
    expect(ids).toEqual(["project:/r/app", "~routines:/r/app", "project:/r/other", "parent", "kid"])
  })

  test("the marker says where a child runs: shared directory or its own worktree", () => {
    expect(childMarkerOf(task("p"))).toBeNull()
    expect(childMarkerOf(task("s", { parentTaskId: "p", sharesWorkspaceOf: "p" }))).toBe("shared")
    expect(childMarkerOf(task("w", { parentTaskId: "p" }))).toBe("worktree")
  })

  test("a folded parent hides its whole subtree and counts every descendant, not just direct children", () => {
    const family = [task("p"), task("c", { parentTaskId: "p" }), task("g", { parentTaskId: "c" }), task("other")]
    const view = (folded: string[], query = "") =>
      navRows(groupByProject(family), query, new Set(), new Set(folded)).flatMap((row) =>
        row.kind === "task" ? [[row.id, row.fold?.collapsed, row.fold?.count]] : [],
      )
    expect(view([])).toEqual([
      ["p", false, 2],
      ["c", false, 1],
      ["g", undefined, undefined],
      ["other", undefined, undefined],
    ])
    expect(view(["p"])).toEqual([
      ["p", true, 2],
      ["other", undefined, undefined],
    ])
    // Folding the middle generation keeps the parent open and hides only the grandchild.
    expect(view(["c"]).map(([id]) => id)).toEqual(["p", "c", "other"])
    // A search shows everything, so a folded parent stays open under it.
    expect(view(["p"], "g").map(([id]) => id)).toEqual(["p", "c", "g"])
  })

  test("a folded parent says its most urgent hidden child: attention, then a question, then running", () => {
    const status = (kind: RowStatus["kind"], since = 1): RowStatus => ({ kind, since })
    const kids = (...kinds: RowStatus["kind"][]) => kinds.map((kind, i) => task(`k${i}`, { rowStatus: status(kind) }))
    expect(mostUrgentStatus(kids("idle", "running", "needs-input"))?.kind).toBe("needs-input")
    expect(mostUrgentStatus(kids("running", "unseen", "attention", "needs-input"))?.kind).toBe("attention")
    expect(mostUrgentStatus(kids("idle", "unseen"))?.kind).toBe("unseen")
    // A tie goes to the most recent; children with no reading yet say nothing.
    const running = (id: string, since: number) => task(id, { rowStatus: status("running", since) })
    expect(mostUrgentStatus([running("a", 1), running("b", 9)])?.since).toBe(9)
    expect(mostUrgentStatus([task("a")])).toBeUndefined()
  })
})
