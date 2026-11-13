/**
 * `task.archive`: hide or restore a task together with its descendants.
 * Archiving ends the subtree's sessions; the guards are the busy refusal (a
 * row that still needs eyes must not be stopped by accident) and the
 * project's `main` checkout, which is the project row itself.
 */

import { describe, expect, it } from "vitest"
import type { Task } from "../../src/types/task.ts"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

const PARENT = { ...TASK, id: "p" } as Task
const CHILD = { ...TASK, id: "c", parentTaskId: "p" } as Task
const GRANDCHILD = { ...TASK, id: "g", parentTaskId: "c" } as Task
const OTHER = { ...TASK, id: "o" } as Task
const MAIN = { ...TASK, id: "m", kind: "main" } as Task
const TASKS = [PARENT, CHILD, GRANDCHILD, OTHER, MAIN]

function archiveCtx(states: Record<string, string> = {}) {
  const calls: Array<[string, boolean]> = []
  const stopped: string[] = []
  const { ctx } = fakeCtx({
    listTasks: () => TASKS,
    getTask: (id: string) => TASKS.find((t) => t.id === id),
    setArchived: async (id: string, archived: boolean) => {
      calls.push([id, archived])
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
  return { ctx: withActivity, calls, stopped }
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

  it("refuses with TASK_BUSY while an engine in the subtree is working or waiting, and writes nothing", async () => {
    for (const state of ["running", "permission_needed"]) {
      const { ctx, calls, stopped } = archiveCtx({ g: state })
      await expect(dispatch("task.archive", { taskId: "p", archived: true }, ctx)).rejects.toThrow(
        /^TASK_BUSY: .*\bg\b/,
      )
      expect(calls).toEqual([])
      expect(stopped).toEqual([])
    }
  })

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

  it("refuses a project's main checkout and an unknown task", async () => {
    const { ctx, calls } = archiveCtx()
    await expect(dispatch("task.archive", { taskId: "m", archived: true }, ctx)).rejects.toThrow(/^MAIN_TASK: /)
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
