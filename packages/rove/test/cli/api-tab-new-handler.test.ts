/** `tab-new --kind engine`: a task's first conversation is its own tab-1, a later one a shared child; a shell stays a tab. */

import { describe, expect, it } from "vitest"
import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import type { OpenedTab } from "../../src/cli/api/tab-new.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const opened = (taskId: string): OpenedTab => ({
  tab: { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
  session: `${taskId}::tab-1`,
})

/** The daemon's `tabs.get` for a task that already holds an engine conversation. */
const withConversation = () => ({
  state: {
    tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1, spawned: true }],
    activeId: "tab-1",
    nextOrdinal: 2,
  },
  rev: 1,
})

describe("tab-new handler", () => {
  it("--kind engine on a task with a conversation spawns a shared child and starts its own tab-1", async () => {
    const child = taskFixture({
      id: "kid",
      command: "codex",
      parentTaskId: "abc",
      sharesWorkspaceOf: "abc",
      worktreePath: "/wt/abc",
    })
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", worktreePath: "/wt/abc" }) }),
      "tabs.get": withConversation,
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

  it("--kind engine on a task with no conversation starts the task's own tab-1 and spawns no child", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", worktreePath: "/wt/abc" }) }),
      "tabs.get": () => ({ state: null, rev: 0 }),
      "terminalTab.add": () => ({ clients: 1 }),
    })
    const targets: string[] = []
    const result = await invokeVerb("tab-new", ["--task-id", "abc", "--kind", "engine"], {
      client,
      runtime: stubRuntime({
        openTab: async (_client, target) => {
          targets.push(target.id)
          return opened(target.id)
        },
      }),
    })

    expect(targets).toEqual(["abc"])
    expect(client.requestNames).not.toContain("task.spawn")
    expect(result).toMatchObject({ ok: true, taskId: "abc", tabId: "tab-1", session: "abc::tab-1", clients: 1 })
    expect(result).not.toHaveProperty("childTaskId")
  })

  it("--kind engine on a task that only opened a shell (unstarted tab-1 beside it) still starts its own tab-1", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", worktreePath: "/wt/abc" }) }),
      "tabs.get": () => ({
        state: {
          tabs: [
            { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
            { kind: "command", id: "tab-2", title: null, ordinal: 2, command: ["sh"] },
          ],
          activeId: "tab-2",
          nextOrdinal: 3,
        },
        rev: 2,
      }),
      "terminalTab.add": () => ({ clients: 0 }),
    })
    const result = await invokeVerb("tab-new", ["--task-id", "abc", "--kind", "engine"], {
      client,
      runtime: stubRuntime({ openTab: async (_client, target) => opened(target.id) }),
    })
    expect(client.requestNames).not.toContain("task.spawn")
    expect(result).not.toHaveProperty("childTaskId")
  })

  it("--kind engine on a task whose unspawned tab-1 holds a live session counts as started: a shared child", async () => {
    const child = taskFixture({ id: "kid", parentTaskId: "abc", sharesWorkspaceOf: "abc", worktreePath: "/wt/abc" })
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", worktreePath: "/wt/abc" }) }),
      "tabs.get": () => ({
        state: { tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }], activeId: "tab-1", nextOrdinal: 2 },
        rev: 1,
      }),
      "task.list": () => ({ tasks: [] }),
      "task.spawn": () => ({ taskId: "kid", task: child, parentDirty: false, sharedLinks: [] }),
    })
    const result = await invokeVerb("tab-new", ["--task-id", "abc", "--kind", "engine"], {
      client,
      runtime: stubRuntime({
        taskTabs: async () => ({ tabs: [{ id: "tab-1", kind: "engine", alive: true }] as never, running: true }),
        openTab: async (_client, target) => opened(target.id),
      }),
    })
    expect(result).toMatchObject({ childTaskId: "kid" })
  })

  it("--kind engine --command on a task with no conversation re-points the task's engine first", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", worktreePath: "/wt/abc" }) }),
      "tabs.get": () => ({ state: null, rev: 0 }),
      "task.setCommand": () => ({}),
      "terminalTab.add": () => ({ clients: 0 }),
    })
    await invokeVerb("tab-new", ["--task-id", "abc", "--kind", "engine", "--command", "codex"], {
      client,
      runtime: stubRuntime({ openTab: async (_client, target) => opened(target.id) }),
    })

    expect(client.requests.find((r) => r.name === "task.setCommand")?.payload).toMatchObject({
      taskId: "abc",
      command: "codex",
    })
    expect(client.requestNames).not.toContain("task.spawn")
  })

  it("--kind engine refused by the engine cap takes the empty child back", async () => {
    const child = taskFixture({ id: "kid", parentTaskId: "abc", sharesWorkspaceOf: "abc", worktreePath: "/wt/abc" })
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", worktreePath: "/wt/abc" }) }),
      "tabs.get": withConversation,
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
