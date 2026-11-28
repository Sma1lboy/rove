/** `project.forget`: un-saves the repo; its rows and their sessions stay. */

import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

it("forgets the repo and ends no session", async () => {
  const tasks = [{ ...TASK, id: "d", kind: "dir" }] as Task[]
  const forgotten: string[] = []
  const stopped: string[] = []
  const { ctx } = fakeCtx({
    listTasks: () => tasks,
    getTask: (id: string) => tasks.find((t) => t.id === id),
    forgetProject: async (repo: string) => {
      forgotten.push(repo)
    },
  })
  const runtime = {
    ...ctx.runtime,
    tearDownTaskSession: async (id: string) => {
      stopped.push(id)
    },
  } as typeof ctx.runtime
  await dispatch("project.forget", { repo: "/repo" }, { ...ctx, runtime })
  expect(forgotten).toEqual(["/repo"])
  expect(stopped).toEqual([])
})
