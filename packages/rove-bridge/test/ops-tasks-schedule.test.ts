import { describe, expect, test } from "bun:test"
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
