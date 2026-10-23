/** `tab-new --kind engine` is a new conversation, so it creates a shared child task; a shell stays a tab. */

import { describe, expect, it } from "vitest"
import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import type { OpenedTab } from "../../src/cli/api/tab-new.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const opened = (taskId: string): OpenedTab => ({
  tab: { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
  session: `${taskId}::tab-1`,
})

describe("tab-new handler", () => {
  it("--kind engine spawns a shared child and starts its own tab-1, leaving the parent's tabs alone", async () => {
    const child = taskFixture({
      id: "kid",
      command: "codex",
      parentTaskId: "abc",
      sharesWorkspaceOf: "abc",
      worktreePath: "/wt/abc",
    })
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", worktreePath: "/wt/abc" }) }),
      "task.spawn": () => ({ taskId: "kid", task: child, parentDirty: false, sharedLinks: [] }),
    })
    const targets: Array<{ id: string }> = []
    const result = await invokeVerb("tab-new", ["--task-id", "abc", "--kind", "engine", "--command", "codex"], {
      client,
      runtime: stubRuntime({
        openTab: async (_client, target) => {
          targets.push(target)
          return opened(target.id)
        },
      }),
    })

    expect(client.requests.find((r) => r.name === "task.spawn")?.payload).toMatchObject({
      parentTaskId: "abc",
      worktree: false,
      command: "codex",
    })
    expect(targets).toEqual([expect.objectContaining({ id: "kid", command: "codex" })])
    expect(result).toMatchObject({ ok: true, taskId: "abc", childTaskId: "kid", tabId: "tab-1", session: "kid::tab-1" })
    expect(client.requestNames).not.toContain("terminalTab.add")
  })

  it("--kind engine refused by the engine cap takes the empty child back", async () => {
    const child = taskFixture({ id: "kid", parentTaskId: "abc", sharesWorkspaceOf: "abc", worktreePath: "/wt/abc" })
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", worktreePath: "/wt/abc" }) }),
      "task.spawn": () => ({ taskId: "kid", task: child, parentDirty: false, sharedLinks: [] }),
      "task.delete": () => ({ queued: true }),
    })
    await expectApiError(
      () =>
        invokeVerb("tab-new", ["--task-id", "abc", "--kind", "engine"], {
          client,
          runtime: stubRuntime({
            openTab: async () => {
              throw new ApiError("engine cap reached", "ENGINE_LIMIT")
            },
          }),
        }),
      "ENGINE_LIMIT",
    )

    expect(client.requests.find((r) => r.name === "task.delete")?.payload).toEqual({ taskId: "kid" })
  })

  it("--kind shell still opens a tab on the task itself", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc" }) }),
      "terminalTab.add": () => ({ clients: 1 }),
    })
    const targets: string[] = []
    const result = await invokeVerb("tab-new", ["--task-id", "abc", "--kind", "shell"], {
      client,
      runtime: stubRuntime({
        openTab: async (_client, target) => {
          targets.push(target.id)
          return {
            tab: { kind: "command", id: "tab-2", title: null, ordinal: 2, command: ["sh"] },
            session: "abc::tab-2",
          }
        },
      }),
    })

    expect(targets).toEqual(["abc"])
    expect(client.requestNames).not.toContain("task.spawn")
    expect(result).toMatchObject({ ok: true, taskId: "abc", tabId: "tab-2" })
  })
})
