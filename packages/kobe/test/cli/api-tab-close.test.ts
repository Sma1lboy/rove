import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

describe("tab-close handler", () => {
  it("uses the attached TUI's normal close path when it confirms the tab", async () => {
    const client = new FakeClient({
      "terminalTab.close": () => ({ ok: true, handled: true }),
    })
    let headlessCalls = 0
    const result = await invokeVerb("tab-close", ["--task-id", "t1", "--tab", "tab-3"], {
      client,
      runtime: stubRuntime({
        closeTerminalTab: async () => {
          headlessCalls++
          return { kind: "engine", wasAlive: true }
        },
      }),
    })
    expect(client.requests).toEqual([{ name: "terminalTab.close", payload: { taskId: "t1", tabId: "tab-3" } }])
    expect(headlessCalls).toBe(0)
    expect(result).toEqual({
      ok: true,
      taskId: "t1",
      tabId: "tab-3",
      handledBy: "tui",
    })
  })

  it("falls back to the headless snapshot and PTY close path", async () => {
    const client = new FakeClient({
      "terminalTab.close": () => ({ ok: true, handled: false }),
      "deferredPrompt.discardTab": () => ({ dropped: ["deferred-1"] }),
    })
    const calls: string[][] = []
    const result = await invokeVerb("tab-close", ["--task-id", "t1", "--tab", "tab-2"], {
      client,
      runtime: stubRuntime({
        closeTerminalTab: async (taskId, tabId) => {
          calls.push([taskId, tabId])
          return { kind: "command", wasAlive: false }
        },
      }),
    })
    expect(calls).toEqual([["t1", "tab-2"]])
    expect(client.requests).toEqual([
      { name: "terminalTab.close", payload: { taskId: "t1", tabId: "tab-2" } },
      {
        name: "deferredPrompt.discardTab",
        payload: { taskId: "t1", tabId: "tab-2" },
      },
    ])
    expect(result).toEqual({
      ok: true,
      taskId: "t1",
      tabId: "tab-2",
      handledBy: "headless",
      kind: "command",
      wasAlive: false,
    })
  })

  it("requires both task and tab ids", async () => {
    const client = new FakeClient()
    await expectApiError(
      () =>
        invokeVerb("tab-close", ["--task-id", "t1"], {
          client,
          runtime: stubRuntime(),
        }),
      "MISSING_FLAG",
    )
    await expectApiError(
      () =>
        invokeVerb("tab-close", ["--tab", "tab-1"], {
          client,
          runtime: stubRuntime(),
        }),
      "MISSING_FLAG",
    )
    expect(client.requestNames).toEqual([])
  })
})
