import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

describe("routine target CLI payload", () => {
  it("sets, retains and clears the exact target, including clearing a stored vendor", async () => {
    const client = new FakeClient({ "automation.update": () => ({ ok: true }) })
    const runtime = stubRuntime()
    await invokeVerb("routine-update", ["--id", "r", "--target-task", "task", "--target-tab", "tab-2"], {
      client,
      runtime,
    })
    await invokeVerb("routine-update", ["--id", "r", "--name", "renamed"], { client, runtime })
    await invokeVerb("routine-update", ["--id", "r", "--target-task", "", "--target-tab", "", "--vendor", ""], {
      client,
      runtime,
    })
    expect(client.requests.map((r) => r.payload)).toEqual([
      { id: "r", target: { kind: "existing-tab", taskId: "task", tabId: "tab-2" } },
      { id: "r", name: "renamed" },
      { id: "r", target: null, vendor: null },
    ])
  })

  it.each([
    ["--target-task", "task"],
    ["--target-tab", "tab-2"],
    ["--target-task", "", "--target-tab", "tab-2"],
  ])("refuses partial target %j", async (...args) => {
    await expect(
      invokeVerb("routine-update", ["--id", "r", ...args], { client: new FakeClient(), runtime: stubRuntime() }),
    ).rejects.toThrow(/target/)
  })
})
