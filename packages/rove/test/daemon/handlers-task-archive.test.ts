/**
 * `task.archive`: hide or restore a task together with its descendants.
 * Archiving ends the subtree's sessions; the one guard is the busy refusal (a
 * row that still needs eyes must not be stopped by accident).
 */

import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

const PARENT = { ...TASK, id: "p" } as Task
const CHILD = { ...TASK, id: "c", parentTaskId: "p" } as Task
const GRANDCHILD = { ...TASK, id: "g", parentTaskId: "c" } as Task
const OTHER = { ...TASK, id: "o" } as Task
const MAIN = { ...TASK, id: "m", kind: "dir" } as Task
/** A bare checkout OTHER cut with no parent: only `dispatcher` says whose it is. */
const CHECKOUT = { ...TASK, id: "w", worktreeOnly: true, dispatcher: { taskId: "o", tabId: "tab-1" } } as Task
const TASKS = [PARENT, CHILD, GRANDCHILD, OTHER, MAIN, CHECKOUT]

function archiveCtx(states: Record<string, string> = {}) {
  const calls: Array<[string, boolean]> = []
  const stopped: string[] = []
  const promoted: string[] = []
  const { ctx } = fakeCtx({
    listTasks: () => TASKS,
    getTask: (id: string) => TASKS.find((t) => t.id === id),
    setArchived: async (id: string, archived: boolean) => {
      calls.push([id, archived])
    },
    promoteChildren: async (id: string) => {
      promoted.push(id)
    },
  })
  const activity = { ...ctx.activity, stateOf: (id: string) => states[id] } as unknown as typeof ctx.activity
  const runtime = {
    ...ctx.runtime,
    tearDownTaskSession: async (id: string) => {
      stopped.push(id)
    },
  } as typeof ctx.runtime
  const withActivity = { ...ctx, activity, runtime }
  return { ctx: withActivity, calls, stopped, promoted }
}

describe("task.archive", () => {
  it("archives the task and every descendant, deepest first, and nothing else", async () => {
    const { ctx, calls } = archiveCtx()
    await expect(dispatch("task.archive", { taskId: "p", archived: true }, ctx)).resolves.toEqual({
      archived: ["g", "c", "p"],
    })
    expect(calls).toEqual([
      ["g", true],
      ["c", true],
      ["p", true],
    ])
  })

  it("with promote, archives the task alone and moves its children up, still running", async () => {
    const { ctx, calls, stopped, promoted } = archiveCtx({ g: "running" })
    await expect(dispatch("task.archive", { taskId: "p", archived: true, promote: true }, ctx)).resolves.toEqual({
      archived: ["p"],
    })
    expect(promoted).toEqual(["p"])
    expect(calls).toEqual([["p", true]])
    expect(stopped).toEqual(["p"])
  })

  it("takes along a bare checkout the task cut, which has no row to archive it from", async () => {
    const { ctx } = archiveCtx()
    await expect(dispatch("task.archive", { taskId: "o", archived: true }, ctx)).resolves.toEqual({
      archived: ["w", "o"],
    })
  })

  it("ends the sessions of every task it archives", async () => {
    const { ctx, stopped } = archiveCtx()
    await dispatch("task.archive", { taskId: "p", archived: true }, ctx)
    expect(stopped).toEqual(["g", "c", "p"])
  })

  it("restores the subtree the same way, and stops nothing", async () => {
    const { ctx, calls, stopped } = archiveCtx()
    await dispatch("task.archive", { taskId: "c", archived: false }, ctx)
    expect(calls).toEqual([
      ["g", false],
      ["c", false],
    ])
    expect(stopped).toEqual([])
  })

  it.each(["running", "permission_needed"])(
    "refuses with TASK_BUSY while an engine in the subtree is %s, and writes nothing",
    async (state) => {
      const { ctx, calls, stopped } = archiveCtx({ g: state })
      await expect(dispatch("task.archive", { taskId: "p", archived: true }, ctx)).rejects.toThrow(
        /^TASK_BUSY: .*\bg\b/,
      )
      expect(calls).toEqual([])
      expect(stopped).toEqual([])
    },
  )

  it("ignores busy engines outside the subtree and idle or finished ones inside it", async () => {
    const { ctx, calls } = archiveCtx({ o: "running", c: "idle", g: "error" })
    await dispatch("task.archive", { taskId: "p", archived: true }, ctx)
    expect(calls.map(([id]) => id)).toEqual(["g", "c", "p"])
  })

  it("archives a busy subtree when force is passed, and restoring never checks", async () => {
    const forced = archiveCtx({ p: "running" })
    await dispatch("task.archive", { taskId: "p", archived: true, force: true }, forced.ctx)
    expect(forced.calls).toHaveLength(3)
    const restore = archiveCtx({ p: "running" })
    await dispatch("task.archive", { taskId: "p", archived: false }, restore.ctx)
    expect(restore.calls).toHaveLength(3)
  })

  it("archives a project checkout session like any other and refuses an unknown task", async () => {
    const main = archiveCtx()
    expect(await dispatch("task.archive", { taskId: "m", archived: true }, main.ctx)).toEqual({ archived: ["m"] })
    const { ctx, calls } = archiveCtx()
    await expect(dispatch("task.archive", { taskId: "nope", archived: true }, ctx)).rejects.toThrow(
      "task not found: nope",
    )
    expect(calls).toEqual([])
  })

  it("requires a boolean archived", async () => {
    const { ctx } = archiveCtx()
    await expect(dispatch("task.archive", { taskId: "p" }, ctx)).rejects.toThrow("archived must be a boolean")
  })
})
