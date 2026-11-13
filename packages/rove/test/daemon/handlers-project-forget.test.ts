/** `project.forget`: the removed project's `main` row takes its sessions with it. */

import { expect, it } from "vitest"
import type { Task } from "../../src/types/task.ts"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

it("ends the sessions of the main row it removes, and of no other task", async () => {
  let tasks = [
    { ...TASK, id: "m", kind: "main" },
    { ...TASK, id: "child", parentTaskId: "m" },
    { ...TASK, id: "m2", kind: "main" },
  ] as Task[]
  const stopped: string[] = []
  const { ctx } = fakeCtx({
    listTasks: () => tasks,
    getTask: (id: string) => tasks.find((t) => t.id === id),
    forgetProject: async () => {
      tasks = tasks.filter((t) => t.id !== "m")
    },
  })
  const runtime = {
    ...ctx.runtime,
    tearDownTaskSession: async (id: string) => {
      stopped.push(id)
    },
  } as typeof ctx.runtime
  await dispatch("project.forget", { repo: "/repo" }, { ...ctx, runtime })
  expect(stopped).toEqual(["m"])
})
