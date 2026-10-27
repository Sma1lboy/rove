import { describe, expect, test } from "vitest"
import {
  AUTO_FOLD_CHILDREN,
  buildTreeRows,
  childMarkerOf,
  treeGuideColumns,
} from "../../src/tui/panes/sidebar/tree-core"
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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}

function rows(over: Partial<Parameters<typeof buildTreeRows>[0]> = {}) {
  return buildTreeRows({
    tasks: [],
    tabsByTask: new Map(),
    ...over,
  })
}

describe("child tasks", () => {
  const root = (over: Partial<Task> = {}) => task("root", { branch: "feat/root", ...over })
  const child = (id: string, parent: string, over: Partial<Task> = {}) =>
    task(id, { parentTaskId: toTaskId(parent), ...over })
  const shape = (result: ReturnType<typeof rows>) =>
    result.filter((r) => r.kind === "worktree").map((r) => [r.id, r.depth])

  test("nest under their parent, one indent per generation, in list order", () => {
    const result = rows({
      tasks: [root(), child("c1", "root"), task("other"), child("c2", "root"), child("g1", "c1")],
    })
    expect(shape(result)).toEqual([
      ["root", 1],
      ["c1", 2],
      ["g1", 3],
      ["c2", 2],
      ["other", 1],
    ])
  })

  test("a child whose parent is missing or filtered out renders top-level", () => {
    const deleting = { phase: "running" } as Task["deletion"]
    const result = rows({
      tasks: [child("orphan", "gone"), root({ deletion: deleting }), child("kid", "root")],
    })
    expect(shape(result)).toEqual([
      ["orphan", 1],
      ["kid", 1],
    ])
  })

  test("indent stops at three levels; deeper rows keep it and carry their real level", () => {
    const result = rows({
      tasks: [root(), child("l2", "root"), child("l3", "l2"), child("l4", "l3"), child("l5", "l4")],
    })
    const worktrees = result.filter((r) => r.kind === "worktree")
    expect(worktrees.map((r) => r.depth)).toEqual([1, 2, 3, 3, 3])
    expect(worktrees.map((r) => r.level)).toEqual([undefined, undefined, undefined, 4, 5])
  })

  test("a folded parent hides its subtree but reports how many it hides and who they are", () => {
    const tasks = [root(), child("c1", "root"), child("g1", "c1"), child("c2", "root")]
    const open = rows({ tasks, collapsedTasks: new Set() })
    const closed = rows({ tasks, collapsedTasks: new Set(["root"]) })
    const fold = (result: ReturnType<typeof rows>) => result.find((r) => r.kind === "worktree" && r.id === "root")
    expect(open.map((r) => r.id)).toEqual(["/repos/rove", "root", "c1", "g1", "c2"])
    expect(closed.map((r) => r.id)).toEqual(["/repos/rove", "root"])
    expect(fold(open)).toMatchObject({ fold: { count: 3, collapsed: false } })
    expect(fold(closed)).toMatchObject({ fold: { count: 3, collapsed: true, descendantIds: ["c1", "g1", "c2"] } })
  })

  test("a task without children has no fold", () => {
    const result = rows({ tasks: [root()], collapsedTasks: new Set(["root"]) })
    expect(result.find((r) => r.kind === "worktree")).not.toHaveProperty("fold")
  })

  describe("a crowded parent folds on its own", () => {
    const family = (kids: number) => [
      root(),
      ...Array.from({ length: kids }, (_, i) => child(`k${i}`, "root")),
      task("other"),
    ]
    const ids = (tasks: Task[], over: Partial<Parameters<typeof buildTreeRows>[0]> = {}) =>
      rows({ tasks, collapsedTasks: new Set(), ...over })
        .filter((r) => r.kind === "worktree")
        .map((r) => r.id)

    test("more than the threshold folds and badges the child count; at the threshold it stays open", () => {
      expect(ids(family(AUTO_FOLD_CHILDREN))).toHaveLength(AUTO_FOLD_CHILDREN + 2)
      expect(ids(family(AUTO_FOLD_CHILDREN + 3))).toEqual(["root", "other"])
      const parent = rows({ tasks: family(8), collapsedTasks: new Set() }).find((r) => r.id === "root")
      expect(parent).toMatchObject({ fold: { count: 8, collapsed: true } })
    })

    test("an open by hand parent stays open; a parent folded by hand stays folded below the threshold", () => {
      expect(ids(family(8), { openedTasks: new Set(["root"]) })).toHaveLength(10)
      expect(ids(family(2), { collapsedTasks: new Set(["root"]) })).toEqual(["root", "other"])
    })

    test("the selected child keeps its crowded parent open, but not against a fold made by hand", () => {
      expect(ids(family(8), { selectedTaskId: "k3" })).toHaveLength(10)
      expect(ids(family(8), { selectedTaskId: "other" })).toEqual(["root", "other"])
      expect(ids(family(8), { selectedTaskId: "k3", collapsedTasks: new Set(["root"]) })).toEqual(["root", "other"])
    })

    test("without a fold set (search, the icon rail) every parent is open", () => {
      const result = rows({ tasks: family(8) })
      expect(result.filter((r) => r.kind === "worktree")).toHaveLength(10)
    })
  })

  test("nest under a parent in another project, and drop the header left with nothing", () => {
    const result = rows({
      tasks: [
        task("m1", { kind: "main", repo: "/repos/a", branch: "", worktreePath: "/repos/a" }),
        task("m2", { kind: "main", repo: "/repos/b", branch: "", worktreePath: "/repos/b" }),
        task("far", { repo: "/repos/b", parentTaskId: toTaskId("m1") }),
      ],
    })
    expect(result.map((r) => [r.kind, r.id, r.depth])).toEqual([
      ["project", "/repos/a", 0],
      ["worktree", "m1", 1],
      ["worktree", "far", 2],
      ["project", "/repos/b", 0],
      ["worktree", "m2", 1],
    ])
    const onlyChild = rows({
      tasks: [
        task("m1", { kind: "main", repo: "/repos/a", branch: "", worktreePath: "/repos/a" }),
        task("far", { repo: "/repos/b", parentTaskId: toTaskId("m1") }),
      ],
    })
    expect(onlyChild.map((r) => r.kind)).toEqual(["project", "worktree", "worktree"])
  })

  test("a lineage that loops back stays on screen instead of vanishing", () => {
    const result = rows({ tasks: [child("a", "b"), child("b", "a")] })
    expect(
      result
        .filter((r) => r.kind === "worktree")
        .map((r) => r.id)
        .sort(),
    ).toEqual(["a", "b"])
  })

  test("scratch children nest under their scratch parent", () => {
    const result = rows({
      tasks: [
        task("s", { kind: "dir", scratch: true, repo: "/Users/me" }),
        task("sc", { kind: "dir", scratch: true, repo: "/Users/me", parentTaskId: toTaskId("s") }),
      ],
    })
    expect(shape(result)).toEqual([
      ["s", 1],
      ["sc", 2],
    ])
  })
})

describe("treeGuideColumns", () => {
  test("a child hooks in with tee or elbow, ancestors with a later sibling draw a line, and a row past the cap is not its parent's sibling", () => {
    const of = (id: string, parent: string) => task(id, { parentTaskId: toTaskId(parent) })
    const result = rows({
      tasks: [task("root"), of("c1", "root"), of("g1", "c1"), of("d4", "g1"), of("c2", "root"), task("other")],
    })
    const guides = treeGuideColumns(result)
    const byId = new Map(result.map((row, i) => [row.id, guides[i]]))
    expect(result.filter((r) => r.kind === "worktree").map((r) => [r.id, byId.get(r.id)])).toEqual([
      ["root", []],
      ["c1", ["tee"]],
      ["g1", ["pipe", "elbow"]],
      ["d4", ["pipe", "elbow"]],
      ["c2", ["elbow"]],
      ["other", []],
    ])
  })
})

describe("childMarkerOf", () => {
  test("tells a shared directory from an own worktree, and a plain task from a child", () => {
    expect(childMarkerOf(task("a"))).toBeNull()
    expect(childMarkerOf(task("b", { parentTaskId: toTaskId("a") }))).toBe("worktree")
    expect(childMarkerOf(task("c", { parentTaskId: toTaskId("a"), sharesWorkspaceOf: toTaskId("a") }))).toBe("shared")
  })
})
