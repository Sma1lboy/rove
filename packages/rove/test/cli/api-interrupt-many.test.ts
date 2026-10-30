import { describe, expect, it, vi } from "vitest"

const pty = vi.hoisted(() => ({
  writes: [] as Array<{ key: string; data: string }>,
  sessions: [] as Array<{ key: string; alive: boolean; command: string }>,
}))
vi.mock("../../src/engine/hosted-session.ts", async (original) => ({
  ...(await original<object>()),
  openHostedSessionHost: async () => ({
    rpc: {
      request: async (name: string, payload: { key: string; data: string }) => {
        if (name === "pty.list") return { sessions: pty.sessions }
        if (name === "pty.write") pty.writes.push(payload)
        return {}
      },
    },
    close() {},
  }),
}))

import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const runtime = stubRuntime()

/** g1 = a running worker, an idle one, and a running one whose pty is gone; t4 runs outside the round. */
function fleet(options: { secondary?: boolean; unknown?: boolean; alias?: boolean; both?: boolean } = {}) {
  pty.writes.length = 0
  pty.sessions = [
    { key: "t1::tab-1", alive: true, command: "claude" },
    { key: "t2::tab-1", alive: true, command: "claude" },
    { key: "t4::tab-1", alive: true, command: "claude" },
  ]
  if (options.secondary) pty.sessions.push({ key: "t1::tab-2", alive: true, command: "claude" })
  const tasks = [
    taskFixture({ id: "t1", groupId: "g1" }),
    taskFixture({ id: "t2", groupId: "g1", ...(options.alias ? { ptyAlias: { taskId: "t1", tabId: "tab-1" } } : {}) }),
    taskFixture({ id: "t3", groupId: "g1" }),
    taskFixture({ id: "t4" }),
  ]
  const at = (state: string) => ({ state, at: 1 })
  return new FakeClient({
    "task.list": () => ({ tasks }),
    "task.get": (payload) => ({ task: tasks.find((t) => t.id === (payload as { taskId: string }).taskId) }),
    "debug.inspect": () => ({
      activity: {
        tasks: { t1: at("running"), t2: at("idle"), t3: at("running"), t4: at("running") },
        tabs: {
          t1: options.unknown
            ? {}
            : {
                "tab-1": at(options.secondary && !options.both ? "idle" : "running"),
                ...(options.secondary ? { "tab-2": at("running") } : {}),
              },
          t2: { "tab-1": at(options.alias ? "running" : "idle") },
          t3: { "tab-1": at("running") },
          t4: { "tab-1": at("running") },
        },
      },
    }),
  })
}

describe("interrupt --group / --all", () => {
  it("writes the interrupt only to the round's running members and records the rest", async () => {
    const result = await invokeVerb("interrupt", ["--group", "g1"], { client: fleet(), runtime })

    expect(pty.writes).toEqual([{ key: "t1::tab-1", data: "\u001b" }])
    expect(result).toMatchObject({
      groupId: "g1",
      count: 3,
      interrupted: 1,
      failures: 1,
      results: [
        { taskId: "t1", tabId: "tab-1", status: "interrupted" },
        { taskId: "t2", status: "skipped", state: "idle" },
        { taskId: "t3", status: "failed", code: "TAB_NOT_FOUND" },
      ],
    })
  })

  it("--all reaches running tasks in every round and none", async () => {
    const result = await invokeVerb("interrupt", ["--all"], { client: fleet(), runtime })

    expect(pty.writes.map((w) => w.key)).toEqual(["t1::tab-1", "t4::tab-1"])
    expect(result).toMatchObject({ count: 4, interrupted: 2 })
  })

  it.each([["--group", "g1"], ["--all"]])(
    "%s interrupts the running secondary tab without touching the idle composer",
    async (...args) => {
      await invokeVerb("interrupt", args, { client: fleet({ secondary: true }), runtime })
      expect(pty.writes.filter((write) => write.key.startsWith("t1::"))).toEqual([{ key: "t1::tab-2", data: "\u001b" }])
    },
  )

  it("interrupts both running tabs of one task", async () => {
    const result = await invokeVerb("interrupt", ["--group", "g1"], {
      client: fleet({ secondary: true, both: true }),
      runtime,
    })
    expect(pty.writes).toEqual([
      { key: "t1::tab-1", data: "\u001b" },
      { key: "t1::tab-2", data: "\u001b" },
    ])
    expect(result).toMatchObject({ count: 3, interrupted: 2, failures: 1 })
  })

  it("continues after a running tab is missing", async () => {
    const client = fleet({ secondary: true })
    pty.sessions = pty.sessions.filter((session) => session.key !== "t1::tab-2")
    const result = await invokeVerb("interrupt", ["--all"], { client, runtime })
    expect(pty.writes).toEqual([{ key: "t4::tab-1", data: "\u001b" }])
    expect(result).toMatchObject({ count: 4, interrupted: 1, failures: 2 })
  })

  it("does not use task-level activity when tab activity is unknown", async () => {
    await invokeVerb("interrupt", ["--group", "g1"], { client: fleet({ unknown: true }), runtime })
    expect(pty.writes).toEqual([])
  })

  it("writes a claimed PTY only for its alias owner", async () => {
    const result = await invokeVerb("interrupt", ["--group", "g1"], { client: fleet({ alias: true }), runtime })
    expect(pty.writes).toEqual([{ key: "t1::tab-1", data: "\u001b" }])
    expect(result).toMatchObject({
      interrupted: 1,
      results: [
        { taskId: "t1", status: "skipped" },
        { taskId: "t2", tabId: "tab-1", status: "interrupted" },
        { taskId: "t3", status: "failed" },
      ],
    })
  })

  it("refuses --tab without --task-id rather than guessing which member's tab it names", async () => {
    await expectApiError(
      () => invokeVerb("interrupt", ["--group", "g1", "--tab", "tab-2"], { client: fleet(), runtime }),
      "BAD_FLAG",
    )
    expect(pty.writes).toEqual([])
  })
})
