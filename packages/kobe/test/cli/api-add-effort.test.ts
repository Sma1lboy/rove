/**
 * `add --effort` — the level a task's FIRST session launches with.
 *
 * Before this flag existed, scripting a codex task at `xhigh` took three
 * steps: `add`, then `set-effort`, then a session rebuild — so the first
 * session, the one that does the opening work, always ran at the engine's
 * default. These pin the payload the level rides on and the gate it must pass,
 * which is deliberately the SAME gate `set-effort` uses
 * (`assertEngineAcceptsEffort`): a level accepted here can never be one
 * `set-effort` would have rejected.
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

describe("add --effort", () => {
  it("rides on task.create as `effort`, so the first session carries it", async () => {
    const client = createClient()
    await invokeVerb("add", ["--repo", "/repo/x", "--command", "codex", "--effort", "xhigh"], {
      client,
      runtime: stubRuntime(),
    })
    // `effort` is the WIRE key the daemon maps onto the record's
    // `modelEffort`; sending `modelEffort` here is dropped without a word, and
    // the create still succeeds — so the payload name is the assertion.
    expect(client.requests[0]).toEqual({
      name: "task.create",
      payload: { repo: "/repo/x", command: "codex", vendor: "codex", effort: "xhigh" },
    })
  })

  it("is optional — an add without it sends no effort at all", async () => {
    const client = createClient()
    await invokeVerb("add", ["--repo", "/repo/x", "--command", "codex"], { client, runtime: stubRuntime() })
    expect(client.requests[0]).toEqual({
      name: "task.create",
      payload: { repo: "/repo/x", command: "codex", vendor: "codex" },
    })
  })

  it("refuses a level the engine does not declare, before creating anything", async () => {
    const client = createClient()
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--command", "codex", "--effort", "bogus"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_EFFORT",
      /none, low, medium, high, xhigh/,
    )
    // The whole point of validating up front: a rejected level must not leave
    // an orphan task behind an error that carries no taskId.
    expect(client.requests).toEqual([])
  })

  it("refuses any level on an engine that declares none", async () => {
    const client = createClient()
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--command", "claude", "--effort", "xhigh"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_EFFORT",
      /declares no reasoning effort levels/,
    )
    expect(client.requests).toEqual([])
  })

  it("applies the level to every sibling of a --count round", async () => {
    const client = createClient()
    const runtime: ApiRuntime = { ...stubRuntime(), deliverPrompt: recordingDelivery().deliver }
    await invokeVerb(
      "add",
      ["--repo", "/repo/x", "--command", "codex", "--effort", "high", "--count", "2", "--prompt", "go"],
      { client, runtime },
    )
    const creates = client.requests.filter((r) => r.name === "task.create")
    expect(creates).toHaveLength(2)
    for (const create of creates) {
      expect((create.payload as { effort?: string }).effort).toBe("high")
    }
  })

  // `--agents` names a different engine per sibling, so one shared level has
  // to hold for all of them. Applying it to the codex sibling and dropping it
  // on the claude one is exactly the silent half-application this gate exists
  // to prevent.
  it("refuses a level no engine in an --agents plan declares", async () => {
    const client = createClient()
    const runtime: ApiRuntime = { ...stubRuntime(), deliverPrompt: recordingDelivery().deliver }
    await expectApiError(
      () =>
        invokeVerb(
          "add",
          ["--repo", "/repo/x", "--agents", "codex:1,claude:1", "--effort", "xhigh", "--prompt", "go"],
          { client, runtime },
        ),
      "BAD_EFFORT",
      /engine claude declares no reasoning effort levels/,
    )
    expect(client.requests).toEqual([])
  })
})
