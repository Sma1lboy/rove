/**
 * The sidebar's shared answer: which tasks are on screen, under which project,
 * in what order.
 *
 * This is the module both sidebar surfaces read, so every rule asserted here
 * is a rule the folded rail obeys as much as the expanded tree — that is the
 * whole reason it exists as a separate function. The parity between the two
 * RENDERERS is pinned on frames in `test/render/sidebar-fold-parity.test.tsx`;
 * what is pinned here is the answer they share.
 */

import { describe, expect, test } from "vitest"
import { buildSidebarGroups } from "../../src/tui/panes/sidebar/project-groups"
import { SCRATCH_SECTION_ID } from "../../src/tui/panes/sidebar/tree-ids"
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

const main = (id: string, repo: string) => task(id, { kind: "main", repo, branch: "", worktreePath: repo })

/** No entry for a task means "never mounted since restart" — the tri-state the
 *  hide rule turns on, and the resting state of a fresh TUI. */
const NO_TABS = new Map<string, { length: number }>()
const tabs = (entries: Record<string, number>) => new Map(Object.entries(entries).map(([id, n]) => [id, { length: n }]))

const groups = (tasks: readonly Task[], tabsByTask = NO_TABS, over = {}) =>
  buildSidebarGroups({ tasks, tabsByTask, ...over })

describe("grouping", () => {
  test("a project's tasks are one contiguous group even when the store interleaves them", () => {
    // tasks.json orders by creation, so two repos worked on in turn arrive
    // interleaved. Walking that order and starting a section whenever the key
    // changes would give one project two headers.
    const result = groups([
      task("a1", { repo: "/work/api" }),
      task("b1", { repo: "/work/web" }),
      task("a2", { repo: "/work/api" }),
    ])
    expect(result.map((g) => g.key)).toEqual(["/work/api", "/work/web"])
    expect(result[0]?.tasks.map((t) => t.id)).toEqual(["a1", "a2"])
  })

  test("the main checkout leads its own project", () => {
    const result = groups([task("b", { repo: "/repos/rove" }), main("m", "/repos/rove")])
    expect(result[0]?.tasks.map((t) => t.id)).toEqual(["m", "b"])
  })

  test("projects follow their mains' stored order, main-less ones after", () => {
    const result = groups([
      task("loose", { repo: "/repos/loose" }),
      main("z", "/repos/zebra"),
      main("a", "/repos/apple"),
    ])
    expect(result.map((g) => g.key)).toEqual(["/repos/zebra", "/repos/apple", "/repos/loose"])
  })

  test("scratch is one bench at the FRONT, wherever the store put it", () => {
    const scratch = task("s1", { kind: "dir", repo: "/tmp/s", scratch: true })
    const result = groups([task("a1", { repo: "/work/api" }), scratch])
    expect(result.map((g) => g.key)).toEqual([SCRATCH_SECTION_ID, "/work/api"])
    expect(result[0]?.tasks.map((t) => t.id)).toEqual(["s1"])
  })

  test("headers disambiguate against the other VISIBLE projects", () => {
    const result = groups([main("a", "/work/api"), main("b", "/oss/api")])
    expect(result.map((g) => g.label)).toEqual(["work/api", "oss/api"])
  })
})

describe("a project closed down to nothing", () => {
  const dead = main("dead", "/work/dead")
  const live = task("live", { repo: "/work/api" })

  test("drops out once its main's last tab closes", () => {
    const result = groups([dead, live], tabs({ dead: 0, live: 1 }))
    expect(result.map((g) => g.key)).toEqual(["/work/api"])
  })

  test("stays while its tabs are merely UNKNOWN — a fresh TUI must not boot empty", () => {
    const result = groups([dead, live], NO_TABS)
    expect(result.map((g) => g.key)).toEqual(["/work/dead", "/work/api"])
  })

  test("returns as soon as its main has a tab again", () => {
    expect(groups([dead], tabs({ dead: 1 })).map((g) => g.key)).toEqual(["/work/dead"])
  })

  test("a project with real work under it always renders, every tab closed", () => {
    const result = groups([dead, task("wt", { repo: "/work/dead" })], tabs({ dead: 0, wt: 0 }))
    expect(result.map((g) => g.key)).toEqual(["/work/dead"])
  })

  test("a hidden project does not disambiguate the visible ones", () => {
    // `/oss/api` is hidden, so `/work/api` is the only `api` left and should
    // render as the bare basename rather than defending against a ghost.
    const result = groups([main("w", "/work/api"), main("o", "/oss/api")], tabs({ o: 0 }))
    expect(result.map((g) => g.label)).toEqual(["api"])
  })

  test("a `dir` row folds the same way a checkout does", () => {
    const dir = task("d", { kind: "dir", repo: "/some/dir", worktreePath: "/some/dir", branch: "" })
    expect(groups([dir], tabs({ d: 0 }))).toEqual([])
  })
})

describe("what never reaches either surface", () => {
  test("a deletion in flight leaves before the worktree teardown does", () => {
    const result = groups([
      task("keep", { repo: "/work/api" }),
      task("queued", { repo: "/work/api", deletion: { phase: "queued" } } as Partial<Task>),
      task("running", { repo: "/work/api", deletion: { phase: "running" } } as Partial<Task>),
    ])
    expect(result[0]?.tasks.map((t) => t.id)).toEqual(["keep"])
  })

  test("a FAILED deletion comes back — the worktree and the entry both survived", () => {
    const result = groups([task("failed", { repo: "/work/api", deletion: { phase: "error" } } as Partial<Task>)])
    expect(result[0]?.tasks.map((t) => t.id)).toEqual(["failed"])
  })
})

describe("routine sessions", () => {
  const routine = (id: string) => task(id, { repo: "/work/api", routine: { automationId: "nightly" } })

  test("sort to the tail of their project, counted so the tree knows the seam", () => {
    const result = groups([routine("r1"), task("own", { repo: "/work/api" }), routine("r2")])
    expect(result[0]?.tasks.map((t) => t.id)).toEqual(["own", "r1", "r2"])
    expect(result[0]?.routineCount).toBe(2)
  })

  test("a project with no routines reports none", () => {
    expect(groups([task("own", { repo: "/work/api" })])[0]?.routineCount).toBe(0)
  })
})
