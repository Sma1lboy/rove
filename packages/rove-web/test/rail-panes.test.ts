import { describe, expect, test } from "bun:test"
import type { SplitNodeView, TabRow, TaskRow } from "rove-bridge/protocol"
import { treeGuides } from "../src/rail-blocks.ts"
import { withPanes } from "../src/rail-panes.ts"
import { type NavRow, foldProjects, groupByProject, navRows } from "../src/rail.ts"

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/shop", kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const leaf = (id: string, own = false, title: string | null = null): SplitNodeView => ({ kind: "leaf", id, title, own })
const tab = (id: string, children?: SplitNodeView[], title = "claude"): TabRow =>
  ({
    id,
    kind: "engine",
    title,
    ...(children ? { split: { root: { kind: "group", orientation: "row", children }, activeLeafId: "leaf-1" } } : {}),
  }) as TabRow

const rowsOf = (tasks: TaskRow[]) => navRows(groupByProject(tasks))
const ids = (rows: readonly NavRow[]) => rows.map((r) => r.id)

describe("split panes in the rail", () => {
  test("a split tab lists one row per pane under its task, in reading order, named like the pane labels", () => {
    const rows = withPanes(rowsOf([task("feat")]), {
      feat: [tab("tab-1", [leaf("leaf-1", true), leaf("leaf-2"), leaf("leaf-3", false, "logs")])],
    })
    expect(ids(rows)).toEqual([
      "project:/r/shop",
      "feat",
      "~pane:feat:tab-1:leaf-1",
      "~pane:feat:tab-1:leaf-2",
      "~pane:feat:tab-1:leaf-3",
    ])
    expect(rows.flatMap((r) => (r.kind === "pane" ? [r.label] : []))).toEqual(["claude", "shell", "logs"])
  })

  test("an unsplit tab, a lone surviving pane and a task with no tabs add no rows", () => {
    const base = rowsOf([task("a"), task("b"), task("c")])
    const rows = withPanes(base, { a: [tab("tab-1")], b: [tab("tab-1", [leaf("leaf-1", true)])] })
    expect(ids(rows)).toEqual(ids(base))
  })

  test("only the split tabs of a task contribute, each pane keeping its own tab", () => {
    const rows = withPanes(rowsOf([task("feat")]), {
      feat: [tab("tab-1"), tab("tab-2", [leaf("leaf-1", true), leaf("leaf-2")], "build")],
    })
    const panes = rows.filter((r) => r.kind === "pane")
    expect(panes.map((r) => (r.kind === "pane" ? `${r.tab.id}/${r.leaf}` : ""))).toEqual([
      "tab-2/leaf-1",
      "tab-2/leaf-2",
    ])
  })

  test("panes sit one level under their task and ahead of its children, with the child tree's guides", () => {
    const rows = withPanes(rowsOf([task("parent"), task("kid", { parentTaskId: "parent" })]), {
      parent: [tab("tab-1", [leaf("leaf-1", true), leaf("leaf-2")])],
    })
    expect(ids(rows)).toEqual([
      "project:/r/shop",
      "parent",
      "~pane:parent:tab-1:leaf-1",
      "~pane:parent:tab-1:leaf-2",
      "kid",
    ])
    expect(rows.map((r) => (r.kind === "task" || r.kind === "pane" ? r.depth : 0))).toEqual([0, 1, 2, 2, 2])
    expect(treeGuides(rows, 2)).toEqual(["tee"])
    expect(treeGuides(rows, 4)).toEqual(["elbow"])
  })

  test("a collapsed project hides its panes with the rest of its rows", () => {
    const rows = withPanes(rowsOf([task("feat")]), { feat: [tab("tab-1", [leaf("leaf-1", true), leaf("leaf-2")])] })
    expect(ids(foldProjects(rows, new Set(["project:/r/shop"])))).toEqual(["project:/r/shop"])
  })
})
