/**
 * `add --model` and `set-model` — pinning a model on a task, gated the way
 * effort is (`assertEngineAcceptsModel`, one gate for both entry points) but
 * WITHOUT a closed set: a model is the engine's own spelling, so the only
 * thing to refuse is an engine that declares no flag to carry it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type ApiRuntime, invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const savedEnv = { taskId: process.env.KOBE_TASK_ID, tabId: process.env.KOBE_TAB_ID }
beforeEach(() => {
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.KOBE_TASK_ID
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.KOBE_TAB_ID
})
afterEach(() => {
  for (const [name, value] of [
    ["KOBE_TASK_ID", savedEnv.taskId],
    ["KOBE_TAB_ID", savedEnv.tabId],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function createClient(): FakeClient {
  return new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
}

describe("add --model", () => {
  it("rides on task.create as `model` — wire key and record field agree", async () => {
    const client = createClient()
    await invokeVerb("add", ["--repo", "/repo/x", "--command", "pi", "--model", "cliproxy/claude-fable-5"], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[0]?.name).toBe("task.create")
    expect(client.requests[0]?.payload).toMatchObject({ command: "pi", vendor: "pi", model: "cliproxy/claude-fable-5" })
  })

  it("is a free string — an id the engine's list never spelled still passes", async () => {
    const client = createClient()
    await invokeVerb("add", ["--repo", "/repo/x", "--command", "claude", "--model", "claude-opus-4-8"], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[0]?.payload).toMatchObject({ model: "claude-opus-4-8" })
  })

  it("refuses an engine that declares no model flag, before creating anything", async () => {
    const client = createClient()
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--command", "copilot", "--model", "gpt-5"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_MODEL",
      /engine copilot declares no model flag/,
    )
    expect(client.requests).toEqual([])
  })

  it("refuses a model when any engine in an --agents plan cannot carry it", async () => {
    const client = createClient()
    const runtime: ApiRuntime = { ...stubRuntime(), deliverPrompt: recordingDelivery().deliver }
    await expectApiError(
      () =>
        invokeVerb(
          "add",
          ["--repo", "/repo/x", "--agents", "claude:1,copilot:1", "--model", "opus", "--prompt", "go"],
          { client, runtime },
        ),
      "BAD_MODEL",
      /engine copilot/,
    )
    expect(client.requests).toEqual([])
  })
})

describe("set-model", () => {
  const taskOf = (task: Record<string, unknown>) => ({ "task.get": () => ({ task: { id: "t1", ...task } }) })

  it("sends the model on task.setVendor, verbatim", async () => {
    const client = new FakeClient({ ...taskOf({ vendor: "claude" }), "task.setVendor": () => ({}) })
    const out = await invokeVerb("set-model", ["--task-id", "t1", "--model", "sonnet"], {
      client,
      runtime: stubRuntime(),
    })
    expect(out).toEqual({ ok: true, taskId: "t1", engine: "claude", model: "sonnet" })
    expect(client.requests.at(-1)).toEqual({
      name: "task.setVendor",
      payload: { taskId: "t1", vendor: "claude", model: "sonnet" },
    })
  })

  it("resolves the engine from a PINNED command and refuses one without a model flag", async () => {
    const client = new FakeClient({
      ...taskOf({ vendor: "generic", command: "copilot --banner" }),
      "task.setVendor": () => ({}),
    })
    await expectApiError(
      () => invokeVerb("set-model", ["--task-id", "t1", "--model", "gpt-5"], { client, runtime: stubRuntime() }),
      "BAD_MODEL",
      /engine copilot/,
    )
    expect(client.requests.map((r) => r.name)).toEqual(["task.get"])
  })
})
