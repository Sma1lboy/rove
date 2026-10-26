/** Request-traffic tests for the `viewers` and `panel-show` verbs. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("viewers", () => {
  it("asks the daemon for every viewer, or one task's, and returns the answer as is", async () => {
    const reply = { viewers: [{ viewer: "bridge-1", surface: "web", taskId: "t9", panel: true, local: true }] }
    const client = new FakeClient({ "ui.viewers": () => reply })
    expect(await invokeVerb("viewers", [], { client, runtime: stubRuntime() })).toEqual(reply)
    await invokeVerb("viewers", ["--task-id", "t9"], { client, runtime: stubRuntime() })
    expect(client.requests.map((r) => r.payload)).toEqual([{}, { taskId: "t9" }])
  })
})

describe("panel-show", () => {
  beforeEach(() => {
    vi.stubEnv("ROVE_TASK_ID", "env-task")
  })

  it("defaults the task to $ROVE_TASK_ID and sends only the flags it was given", async () => {
    const client = new FakeClient({ "panel.show": () => ({ shown: 1, remembered: 1, viewers: [] }) })
    await invokeVerb("panel-show", ["--view", "files", "--path", "src/a.ts"], { client, runtime: stubRuntime() })
    expect(client.requestNames).toEqual(["panel.show"])
    expect(client.requests[0].payload).toEqual({ taskId: "env-task", view: "files", path: "src/a.ts" })
  })

  it("an explicit --task-id wins, and a browser view carries its url", async () => {
    const client = new FakeClient({ "panel.show": () => ({ shown: 0, remembered: 0, viewers: [] }) })
    await invokeVerb("panel-show", ["--task-id", "t9", "--view", "browser", "--url", "https://example.com"], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[0].payload).toEqual({ taskId: "t9", view: "browser", url: "https://example.com" })
  })

  it("with no task named, no $ROVE_TASK_ID and no active task it says so before any RPC", async () => {
    vi.stubEnv("ROVE_TASK_ID", "")
    const client = new FakeClient({ "task.active": () => ({ activeTaskId: null }) })
    await expectApiError(
      () => invokeVerb("panel-show", ["--view", "diff"], { client, runtime: stubRuntime() }),
      "MISSING_TARGET",
    )
    expect(client.requestNames).not.toContain("panel.show")
  })

  it("rejects a view that is not browser, files or diff before any RPC", async () => {
    const client = new FakeClient()
    await expectApiError(
      () => invokeVerb("panel-show", ["--view", "pdf"], { client, runtime: stubRuntime() }),
      "BAD_FLAG",
    )
    await expectApiError(() => invokeVerb("panel-show", [], { client, runtime: stubRuntime() }), "MISSING_FLAG")
    expect(client.requestNames).toEqual([])
  })
})
