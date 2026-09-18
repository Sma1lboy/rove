/**
 * `add --tier` — filling engine/model/effort from the auto-effort table.
 * The account probe is mocked: the gate's login half is what a real
 * `detectEngineStatus` answers, and the answer must not depend on who is
 * logged into the machine running the suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const probe = vi.hoisted(() => ({ kind: "oauth" as string }))
vi.mock("../../src/engine/engine-status.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/engine/engine-status.ts")>()
  return {
    ...actual,
    detectEngineStatus: async (vendor: string) => ({
      vendor,
      binary: { found: true, path: `/usr/local/bin/${vendor}` },
      account: { kind: probe.kind },
    }),
  }
})

const { invokeVerb } = await import("../../src/cli/api-cmd.ts")
const { FakeClient, expectApiError, stubRuntime, taskFixture } = await import("./api-handler-fixtures.ts")

const savedEnv = { taskId: process.env.KOBE_TASK_ID, tabId: process.env.KOBE_TAB_ID }
beforeEach(() => {
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.KOBE_TASK_ID
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.KOBE_TAB_ID
  probe.kind = "oauth"
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

const createClient = () => new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })

describe("add --tier", () => {
  it("fills engine + model from the shipped table and records the tier", async () => {
    const client = createClient()
    await invokeVerb("add", ["--repo", "/repo/x", "--tier", "deep"], { client, runtime: stubRuntime() })
    expect(client.requests[0]?.name).toBe("task.create")
    expect(client.requests[0]?.payload).toMatchObject({
      command: "claude",
      vendor: "claude",
      model: "fable",
      tier: "deep",
    })
    expect(client.requests[0]?.payload).not.toHaveProperty("effort")
  })

  it("refuses an explicit engine field beside a tier — both cannot apply", async () => {
    for (const extra of [
      ["--model", "opus"],
      ["--effort", "high"],
      ["--command", "codex"],
    ]) {
      const client = createClient()
      await expectApiError(
        () => invokeVerb("add", ["--repo", "/repo/x", "--tier", "deep", ...extra], { client, runtime: stubRuntime() }),
        "CONFLICTING_FLAGS",
        /conflicts with --tier/,
      )
      expect(client.requests).toEqual([])
    }
  })

  it("refuses a tier whose engine is not logged in, before creating anything", async () => {
    probe.kind = "none"
    const client = createClient()
    await expectApiError(
      () => invokeVerb("add", ["--repo", "/repo/x", "--tier", "swift"], { client, runtime: stubRuntime() }),
      "TIER_UNAVAILABLE",
      /not logged in/,
    )
    expect(client.requests).toEqual([])
  })
})
