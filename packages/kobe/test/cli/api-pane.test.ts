/** Request-traffic tests for the `pane-open` verb. */

import { resolveLoginShell } from "@sma1lboy/kobe-daemon/daemon/platform-shell"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

describe("pane-open handler", () => {
  beforeEach(() => {
    vi.stubEnv("KOBE_TASK_ID", "env-task")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("wraps --command in the login shell's -ilc, defaults split/right, titles from the command word", async () => {
    const client = new FakeClient({ "tab.open": () => ({ ok: true, clients: 1 }) })
    const result = (await invokeVerb("pane-open", ["--command", "btop --utf-force"], {
      client,
      runtime: stubRuntime(),
    })) as { ok: boolean; clients: number; title: string }
    expect(client.requestNames).toEqual(["tab.open"])
    expect(client.requests[0].payload).toEqual({
      taskId: "env-task",
      argv: [resolveLoginShell({ fallback: "/bin/sh" }), "-ilc", "btop --utf-force"],
      title: "btop",
      placement: "split",
      direction: "right",
    })
    // The resolved title rides back in the result — it is what `pane-close
    // --title` must match — and the daemon's reach signal passes through.
    expect(result).toEqual({ ok: true, clients: 1, title: "btop" })
  })

  it("no --command opens an interactive login shell; explicit flags pass through", async () => {
    const client = new FakeClient({ "tab.open": () => ({ ok: true, clients: 2 }) })
    const result = (await invokeVerb(
      "pane-open",
      ["--task-id", "t9", "--direction", "down", "--placement", "tab", "--title", "logs"],
      {
        client,
        runtime: stubRuntime(),
      },
    )) as { title: string }
    const payload = client.requests[0].payload as { taskId: string; argv: string[]; title: string }
    expect(payload.taskId).toBe("t9")
    expect(payload.argv).toEqual([resolveLoginShell({ fallback: "/bin/sh" }), "-il"])
    expect(payload.title).toBe("logs")
    expect(client.requests[0].payload).toMatchObject({ placement: "tab", direction: "down" })
    // An explicit --title is echoed back verbatim.
    expect(result.title).toBe("logs")
  })

  it("pane-close passes taskId + title over tab.close; --title is required", async () => {
    const client = new FakeClient({ "tab.close": () => ({ ok: true, clients: 0 }) })
    const result = (await invokeVerb("pane-close", ["--task-id", "t9", "--title", "fx"], {
      client,
      runtime: stubRuntime(),
    })) as { ok: boolean; clients: number }
    expect(client.requestNames).toEqual(["tab.close"])
    expect(client.requests[0].payload).toEqual({ taskId: "t9", title: "fx" })
    // The daemon's reach signal (0 = no attached TUI performed the close)
    // passes through unaltered — a headless close must be visible.
    expect(result).toEqual({ ok: true, clients: 0 })
    const bare = new FakeClient()
    await expectApiError(() => invokeVerb("pane-close", [], { client: bare, runtime: stubRuntime() }), "MISSING_FLAG")
    expect(bare.requestNames).toEqual([])
  })

  it("--tab scopes both verbs' payloads to one tab", async () => {
    const client = new FakeClient({ "tab.open": () => ({ ok: true }), "tab.close": () => ({ ok: true }) })
    await invokeVerb("pane-open", ["--task-id", "t9", "--tab", "tab-3", "--command", "btop"], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[0].payload).toMatchObject({ taskId: "t9", tabId: "tab-3" })
    await invokeVerb("pane-close", ["--task-id", "t9", "--tab", "tab-3", "--title", "btop"], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[1].payload).toEqual({ taskId: "t9", title: "btop", tabId: "tab-3" })
  })

  it("rejects an out-of-range --direction before any RPC", async () => {
    const client = new FakeClient()
    await expectApiError(
      () => invokeVerb("pane-open", ["--direction", "sideways"], { client, runtime: stubRuntime() }),
      "BAD_FLAG",
    )
    expect(client.requestNames).toEqual([])
  })
})
