import { describe, expect, test } from "bun:test"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { T, isolateTaskOpDeps, refused, run } from "./task-ops-harness.ts"

isolateTaskOpDeps()

describe("task.scheduleStart", () => {
  test("forwards the time and the first message as one daemon call", async () => {
    const at = "2026-11-07T01:30:00.000Z"
    const { calls } = await run("task.scheduleStart", { taskId: T, at, prompt: "fix it" })
    expect(calls).toEqual([{ rpc: "task.scheduleStart", payload: { taskId: T, at, prompt: "fix it" } }])
  })

  test("a time that is not a date, or an empty message, never reaches the daemon", async () => {
    await refused("task.scheduleStart", { taskId: T, at: "tomorrow", prompt: "x" })
    await refused("task.scheduleStart", { taskId: T, at: "2026-11-07T01:30:00Z", prompt: "  " })
  })
})

describe("a scheduled start rides on the create, so no task exists with neither an agent nor a due start", () => {
  const at = "2026-11-07T01:30:00.000Z"

  test("task.spawn hands the schedule to add in-process, never as a flag", async () => {
    const { calls } = await run(
      "task.spawn",
      { repo: "/w/app", scheduleAt: at, schedulePrompt: "fix it" },
      { add: { taskId: "N1", task: {} } },
    )
    expect(calls).toEqual([
      { verb: "add", argv: ["--repo=/w/app"], local: { scheduledStart: { at, prompt: "fix it" } } },
    ])
  })

  test("task.openCheckout writes it with the directory task", async () => {
    taskOpDeps.validateRepoPath = () => null
    const { calls } = await run(
      "task.openCheckout",
      { repo: "/w/app", scheduleAt: at, schedulePrompt: "fix it" },
      { "task.ensureMain": { task: { repo: "/w/app" } }, "task.openDir": { taskId: "D1" } },
    )
    expect(calls.find((c) => "rpc" in c && c.rpc === "task.openDir")).toMatchObject({
      payload: { dir: "/w/app", scheduledStart: { at, prompt: "fix it" } },
    })
  })

  test("a bad time, an empty message, or a prompt beside it never creates anything", async () => {
    await refused("task.spawn", { repo: "/w/app", scheduleAt: "tomorrow", schedulePrompt: "x" })
    await refused("task.spawn", { repo: "/w/app", scheduleAt: at, schedulePrompt: "  " })
    await refused("task.spawn", { repo: "/w/app", scheduleAt: at, schedulePrompt: "x", prompt: "now" })
  })
})

describe("task.resumeQuota", () => {
  test("continues the named task now", async () => {
    const { calls } = await run("task.resumeQuota", { taskId: T })
    expect(calls).toEqual([{ rpc: "task.resumeQuota", payload: { taskId: T } }])
  })
})
