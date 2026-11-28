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

import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { toTaskId } from "@sma1lboy/rove-core/types/task.ts"
import { describe, expect, test } from "vitest"
import { buildSidebarGroups } from "../../src/tui/panes/sidebar/project-groups"
import { SCRATCH_SECTION_ID } from "../../src/tui/panes/sidebar/tree-ids"

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

/** A session in the project's own checkout. */
const checkout = (id: string, repo: string) => task(id, { kind: "dir", repo, branch: "", worktreePath: repo })

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

  test.each(["default", "recent", "attention", "name"])("pinned tasks lead their project in %s order", (sortMode) => {
    const first = task("Apple")
    const pinned = task("Zebra", { pinned: true, createdAt: "2025-01-01T00:00:00Z" })
    expect(groups([first, pinned], NO_TABS, { sortMode })[0]?.tasks).toEqual([pinned, first])
  })

  test("project headers sort by displayed name or newest member, including unpinned tasks", () => {
    const tasks = [
      task("oldest", { repo: "/repo/tool1", createdAt: "2025-01-01T00:00:00Z" }),
      task("old", { repo: "/repo/tool10", pinned: true }),
      task("older", { repo: "/repo/tool2", createdAt: "2026-08-02T00:00:00Z" }),
      task("new", { repo: "/repo/tool10", createdAt: "2026-08-03T00:00:00Z" }),
      task("scratch", { kind: "dir", scratch: true }),
    ]
    const labels = (sortMode: string) => groups(tasks, NO_TABS, { sortMode }).map((group) => group.label)
    expect(labels("name")).toEqual(["Ungrouped", "tool1", "tool2", "tool10"])
    expect(labels("recent")).toEqual(["Ungrouped", "tool10", "tool2", "tool1"])
  })

  test("scratch is one bench at the FRONT, wherever the store put it", () => {
    const scratch = task("s1", { kind: "dir", repo: "/tmp/s", scratch: true })
    const result = groups([task("a1", { repo: "/work/api" }), scratch])
    expect(result.map((g) => g.key)).toEqual([SCRATCH_SECTION_ID, "/work/api"])
    expect(result[0]?.tasks.map((t) => t.id)).toEqual(["s1"])
  })

  test("a chat connector's project sinks below every project added after it", () => {
    const wechat = checkout("w1", "/home/.rove/weixin/agent")
    const result = groups([{ ...wechat, connector: "weixin" }, task("a1", { repo: "/work/api" })])
    expect(result.map((g) => g.key)).toEqual(["/work/api", "/home/.rove/weixin/agent"])
    expect(result[1]?.connector).toBe("weixin")
  })

  test("a projectless routine's dir task joins the Ungrouped bench, not a project of its own", () => {
    const home = "/home/.rove/routines/a1"
    const dir = task("d1", { kind: "dir", repo: home, worktreePath: home, noProject: true })
    const scratch = task("s1", { kind: "dir", repo: "/tmp/s", scratch: true })
    const result = groups([task("a1", { repo: "/work/api" }), dir, scratch])
    expect(result.map((g) => g.key)).toEqual([SCRATCH_SECTION_ID, "/work/api"])
    expect(result[0]?.label).toBe("Ungrouped")
    expect(result[0]?.tasks.map((t) => t.id)).toEqual(["d1", "s1"])
  })

  test("headers disambiguate against the other VISIBLE projects", () => {
    const result = groups([checkout("a", "/work/api"), checkout("b", "/oss/api")])
    expect(result.map((g) => g.label)).toEqual(["work/api", "oss/api"])
  })
})

describe("a project closed down to nothing", () => {
  const dead = checkout("dead", "/work/dead")
  const live = task("live", { repo: "/work/api" })

  test("drops out once its only session's last tab closes", () => {
    const result = groups([dead, live], tabs({ dead: 0, live: 1 }))
    expect(result.map((g) => g.key)).toEqual(["/work/api"])
  })

  test("stays while its tabs are merely UNKNOWN — a fresh TUI must not boot empty", () => {
    const result = groups([dead, live], NO_TABS)
    expect(result.map((g) => g.key)).toEqual(["/work/dead", "/work/api"])
  })

  test("a remote worktree stays under its project after its last tab closes", () => {
    const remote = {
      ...checkout("remote", "/links/deck/rove"),
      workspace: { backend: "remote" as const },
      repoId: "github.com/org/rove",
    }
    expect(groups([remote], tabs({ remote: 0 })).map((group) => group.tasks)).toEqual([[remote]])
  })

  test("returns as soon as that session has a tab again", () => {
    expect(groups([dead], tabs({ dead: 1 })).map((g) => g.key)).toEqual(["/work/dead"])
  })

  test("a project with real work under it always renders, every tab closed", () => {
    const result = groups([dead, task("wt", { repo: "/work/dead" })], tabs({ dead: 0, wt: 0 }))
    expect(result.map((g) => g.key)).toEqual(["/work/dead"])
  })

  test("a hidden project does not disambiguate the visible ones", () => {
    // `/oss/api` is hidden, so `/work/api` is the only `api` left and should
    // render as the bare basename rather than defending against a ghost.
    const result = groups([checkout("w", "/work/api"), checkout("o", "/oss/api")], tabs({ o: 0 }))
    expect(result.map((g) => g.label)).toEqual(["api"])
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

describe("routine runs", () => {
  const routine = (id: string, over: Partial<Task> = {}) =>
    task(id, { repo: "/work/api", routine: { automationId: "nightly" }, ...over })

  test("are never listed; they open from the Routines page", () => {
    const result = groups([routine("r1"), task("own", { repo: "/work/api" }), routine("r2")])
    expect(result.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(["own"])
  })

  test("a projectless run leaves Ungrouped too", () => {
    const home = "/home/.rove/routines/a1"
    const run = routine("r1", { kind: "dir", repo: home, worktreePath: home, noProject: true })
    const scratch = task("s1", { kind: "dir", repo: "/tmp/s", scratch: true })
    expect(groups([run, scratch])[0]?.tasks.map((t) => t.id)).toEqual(["s1"])
  })

  test("a project whose only other row is an idle session in its checkout closes down", () => {
    const result = groups([checkout("m", "/work/api"), routine("r1")], tabs({ m: 0 }))
    expect(result).toEqual([])
  })
})
