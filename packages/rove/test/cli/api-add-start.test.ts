/** `add --start` without a `--prompt`: the task's engine boots idle in its own tab-1, where a bare `add` only creates the row. */

import { describe, expect, it } from "vitest"
import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const created = () => ({ taskId: "t1", task: taskFixture() })

describe("add --start", () => {
  it("opens tab-1 and starts the engine idle", async () => {
    const client = new FakeClient({ "task.create": created })
    const opened: Array<{ id: string; kind: string }> = []
    const result = await invokeVerb("add", ["--repo", "/repo/x", "--start"], {
      client,
      runtime: stubRuntime({
        openTab: async (_client, target, kind) => {
          opened.push({ id: target.id, kind })
          return { tab: { kind: "engine", id: "tab-1", title: null, ordinal: 1 }, session: "t1::tab-1" }
        },
      }),
    })

    expect(opened).toEqual([{ id: "t1", kind: "engine" }])
    expect(result).toMatchObject({ taskId: "t1", started: true, tabId: "tab-1", session: "t1::tab-1" })
  })

  it("leaves a bare add a backlog row with no engine", async () => {
    const client = new FakeClient({ "task.create": created })
    const result = await invokeVerb("add", ["--repo", "/repo/x"], {
      client,
      runtime: stubRuntime({
        openTab: async () => {
          throw new Error("a bare add must not start an engine")
        },
      }),
    })

    expect(result).toMatchObject({ taskId: "t1", started: false })
  })

  it("keeps the task it created and names it when the engine does not start", async () => {
    const client = new FakeClient({ "task.create": created })
    const err = await invokeVerb("add", ["--repo", "/repo/x", "--start"], {
      client,
      runtime: stubRuntime({
        openTab: async () => {
          throw new ApiError("engine cap reached", "ENGINE_LIMIT")
        },
      }),
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ code: "ENGINE_LIMIT", data: { taskId: "t1" } })
    expect(client.requestNames).toEqual(["task.create"])
  })

  it.each([
    ["--prompt", ["--prompt", "do it"]],
    ["--count", ["--count", "2", "--prompt", "do it"]],
  ])("refuses --start beside %s", async (_name, extra) => {
    const client = new FakeClient({ "task.create": created })
    const err = await invokeVerb("add", ["--repo", "/repo/x", "--start", ...extra], {
      client,
      runtime: stubRuntime(),
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ code: "CONFLICTING_FLAGS" })
    expect(client.requestNames).toEqual([])
  })
})
