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

describe("Later records a pending start: nothing is created until its time", () => {
  const at = "2026-11-07T01:30:00.000Z"

  test("task.spawn records the add it will run, its flags as given and the prompt apart", async () => {
    const { calls, result } = await run(
      "task.spawn",
      { repo: "/w/app", engine: "claude", scheduleAt: at, schedulePrompt: "fix it" },
      { "pendingStart.add": { id: "P1" } },
    )
    expect(calls.filter((c) => !("verb" in c && c.verb === "engine-list"))).toEqual([
      {
        rpc: "pendingStart.add",
        payload: {
          at,
          prompt: "fix it",
          title: "fix it",
          repo: "/w/app",
          create: { via: "add", params: { repo: "/w/app", command: "claude" } },
        },
      },
    ])
    expect(result).toEqual({ taskIds: [], pendingStartId: "P1" })
  })

  test("task.openCheckout records the session and opens no project row now", async () => {
    taskOpDeps.validateRepoPath = () => null
    const { calls } = await run(
      "task.openCheckout",
      { repo: "/w/app", scheduleAt: at, schedulePrompt: "fix it" },
      { "pendingStart.add": { id: "P1" } },
    )
    expect(calls.map((c) => ("rpc" in c ? c.rpc : c.verb))).toEqual(["pendingStart.add"])
    expect(calls[0]).toMatchObject({ payload: { create: { via: "dir", dir: "/w/app", project: true } } })
  })

  test("a bad time, an empty message, or a prompt beside it records nothing", async () => {
    await refused("task.spawn", { repo: "/w/app", scheduleAt: "tomorrow", schedulePrompt: "x" })
    await refused("task.spawn", { repo: "/w/app", scheduleAt: at, schedulePrompt: "  " })
    await refused("task.spawn", { repo: "/w/app", scheduleAt: at, schedulePrompt: "x", prompt: "now" })
  })

  test("the pending list and a cancel go to the daemon by id", async () => {
    const { calls } = await run("pendingStart.cancel", { id: "P1" })
    expect(calls).toEqual([{ rpc: "pendingStart.cancel", payload: { id: "P1" } }])
  })
})

describe("task.resumeQuota", () => {
  test("continues the named task now", async () => {
    const { calls } = await run("task.resumeQuota", { taskId: T })
    expect(calls).toEqual([{ rpc: "task.resumeQuota", payload: { taskId: T } }])
  })
})
