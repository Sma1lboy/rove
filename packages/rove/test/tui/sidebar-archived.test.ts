/**
 * Archived tasks in the sidebar: gone from every project (so a project left
 * with only its main folds like any idle one) and listed nowhere else in the
 * tree, and the row menu that hides or restores them.
 */

import { describe, expect, test, vi } from "vitest"
import { archiveTaskAction } from "../../src/tui-react/workspace/archive-task-action"
import { buildSidebarGroups } from "../../src/tui/panes/sidebar/project-groups"
import { treeMenuItems } from "../../src/tui/panes/sidebar/tree-menu"
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
const tabs = (entries: Record<string, number>) => new Map(Object.entries(entries).map(([id, n]) => [id, { length: n }]))

describe("archived tasks leave the projects", () => {
  test("a worktree-only checkout is never a sidebar row, with or without a parent", () => {
    const result = buildSidebarGroups({
      tasks: [
        main("m", "/repos/rove"),
        task("parent"),
        task("checkout", { worktreeOnly: true, parentTaskId: toTaskId("parent") }),
        task("orphan", { worktreeOnly: true }),
      ],
      tabsByTask: new Map(),
    })
    expect(result.map((g) => g.tasks.map((t) => t.id))).toEqual([["m", "parent"]])
  })

  test("an archived row is in no group; its live siblings stay", () => {
    const result = buildSidebarGroups({
      tasks: [main("m", "/repos/rove"), task("live"), task("gone", { archived: true })],
      tabsByTask: new Map(),
    })
    expect(result.map((g) => g.tasks.map((t) => t.id))).toEqual([["m", "live"]])
  })

  test("a project whose only other rows are archived folds like an idle project", () => {
    const tasks = [main("m", "/repos/api"), task("gone", { repo: "/repos/api", archived: true })]
    expect(buildSidebarGroups({ tasks, tabsByTask: tabs({ m: 0 }) })).toEqual([])
    // Unknown tabs never hide, archived or not.
    expect(buildSidebarGroups({ tasks, tabsByTask: new Map() })).toHaveLength(1)
  })
})

describe("the row menu", () => {
  const actions = (over: Partial<Task>) =>
    treeMenuItems({ kind: "worktree", id: "a", task: task("a", over), depth: 1 }).filter(
      (item) => item.action === "archive",
    )

  test("offers Archive on a task, Unarchive on an archived one, and nothing on a project's main", () => {
    expect(actions({}).map((item) => item.labelKey)).toEqual(["tasks.menu.archive"])
    expect(actions({ archived: true }).map((item) => item.labelKey)).toEqual(["tasks.menu.unarchive"])
    expect(actions({ kind: "main", branch: "" })).toEqual([])
  })

  test("archive is not toned as danger: it removes nothing", () => {
    expect(actions({})[0]?.danger).toBeUndefined()
  })
})

describe("archiveTaskAction", () => {
  function harness(archiveTask: (id: string, archived: boolean, force?: boolean) => Promise<void>, confirm = true) {
    const info: string[] = []
    const errors: string[] = []
    const asked: string[] = []
    const deps = {
      orchestrator: { archiveTask },
      confirmBusy: async (title: string) => {
        asked.push(title)
        return confirm
      },
      notifyInfo: (m: string) => void info.push(m),
      notifyError: (m: string) => void errors.push(m),
      t: (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    }
    return { deps, info, errors, asked }
  }
  const busy = () => {
    throw new Error("TASK_BUSY: an engine is still working or waiting on you in a")
  }

  test("archives an unarchived task and restores an archived one", async () => {
    const calls: unknown[] = []
    const h = harness(async (...args) => void calls.push(args))
    expect(await archiveTaskAction(h.deps, { id: toTaskId("a"), title: "Fix" })).toBe(true)
    expect(await archiveTaskAction(h.deps, { id: toTaskId("a"), title: "Fix", archived: true })).toBe(true)
    expect(calls).toEqual([
      ["a", true, false],
      ["a", false, false],
    ])
    expect(h.info).toEqual(['tasks.archive.done {"title":"Fix"}', 'tasks.archive.restored {"title":"Fix"}'])
  })

  test("a busy refusal asks once, and Archive anyway retries with force", async () => {
    const archive = vi
      .fn<(id: string, archived: boolean, force?: boolean) => Promise<void>>()
      .mockImplementationOnce(async () => busy())
      .mockResolvedValue(undefined)
    const h = harness(archive)
    expect(await archiveTaskAction(h.deps, { id: toTaskId("a"), title: "Fix" })).toBe(true)
    expect(h.asked).toEqual(["Fix"])
    expect(archive.mock.calls).toEqual([
      ["a", true, false],
      ["a", true, true],
    ])
    expect(h.errors).toEqual([])
  })

  test("declining leaves the task as it was, with no toast", async () => {
    const calls: unknown[] = []
    const h = harness(async (...args) => {
      calls.push(args)
      busy()
    }, false)
    expect(await archiveTaskAction(h.deps, { id: toTaskId("a"), title: "Fix" })).toBe(false)
    expect(calls).toHaveLength(1)
    expect([...h.info, ...h.errors]).toEqual([])
  })

  test("any other refusal is an error naming the daemon's reason, without its code", async () => {
    const h = harness(async () => {
      throw new Error("MAIN_TASK: a project's main checkout cannot be archived")
    })
    expect(await archiveTaskAction(h.deps, { id: toTaskId("m"), title: "rove" })).toBe(false)
    expect(h.asked).toEqual([])
    expect(h.errors).toEqual(['tasks.archive.failed {"error":"a project\'s main checkout cannot be archived"}'])
  })
})
