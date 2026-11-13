/**
 * `add --parent X --no-worktree --prompt P`: a new conversation in a task's own directory. An unstarted
 * parent takes it itself; a parent that already ran one gets a shared child. (`send` only delivers into
 * conversations that exist: `send --tab new` is refused in api-handlers-send.test.ts.)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { resetVerifiedSelfSession, verifiedSelfSession } from "../../src/cli/api/dispatcher.ts"
import { FakeClient, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

// Dispatcher provenance keys off the caller's own $ROVE_TASK_ID/$ROVE_TAB_ID: unset them so exact-payload
// assertions stay deterministic when the runner itself lives inside a rove task.
const saved = { taskId: process.env.ROVE_TASK_ID, tabId: process.env.ROVE_TAB_ID }
beforeEach(() => {
  Reflect.deleteProperty(process.env, "ROVE_TASK_ID")
  Reflect.deleteProperty(process.env, "ROVE_TAB_ID")
  resetVerifiedSelfSession()
})
afterEach(() => {
  resetVerifiedSelfSession()
  for (const [name, value] of [
    ["ROVE_TASK_ID", saved.taskId],
    ["ROVE_TAB_ID", saved.tabId],
  ] as const) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
})

/** A parent that already ran its own conversation, so a new one becomes a shared child. */
function startedParentClient(child = taskFixture({ id: "kid", parentTaskId: "abc", sharesWorkspaceOf: "abc" })) {
  return new FakeClient({
    "task.get": () => ({ task: taskFixture({ id: "abc", vendor: "claude" }) }),
    "tabs.get": () => ({
      state: { tabs: [{ kind: "engine", id: "tab-1", spawned: true }], activeId: "tab-1" },
      rev: 1,
    }),
    "task.spawn": () => ({ taskId: child.id, task: child, parentDirty: false, sharedLinks: [] }),
    "task.setPrompt": () => ({}),
  })
}

/** Make this process a verified descendant of sender-1's tab-1, as a real `rove api add` inside the tab is. */
async function asSender() {
  await verifiedSelfSession(
    { ROVE_TASK_ID: "sender-1", ROVE_TAB_ID: "tab-1" },
    {
      pid: 500,
      sessions: async () => [{ key: "sender-1::tab-1", pid: 100, alive: true }],
      ps: async () => "  100     1 /bin/zsh -il\n  500   100 bun rove api add",
    },
  )
  process.env.ROVE_TASK_ID = "sender-1"
  process.env.ROVE_TAB_ID = "tab-1"
}

describe("add --parent --no-worktree: a new conversation in the task's directory", () => {
  it("on a started parent creates a shared child running the pinned engine, and delivers the prompt to it", async () => {
    const child = taskFixture({
      id: "kid",
      vendor: "codex",
      command: "codex",
      parentTaskId: "abc",
      sharesWorkspaceOf: "abc",
    })
    const client = startedParentClient(child)
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb(
      "add",
      ["--parent", "abc", "--no-worktree", "--prompt", "hi", "--command", "codex"],
      { client, runtime: stubRuntime({ deliverPrompt: deliver }) },
    )
    expect(client.requests.find((r) => r.name === "task.spawn")?.payload).toMatchObject({
      parentTaskId: "abc",
      worktree: false,
      title: "hi",
      command: "codex",
      vendor: "codex",
    })
    // The prompt goes to the child's canonical engine; the parent's conversation is untouched.
    expect(calls).toHaveLength(1)
    expect(calls[0].target).toMatchObject({ id: "kid", command: "codex" })
    expect(calls[0].target.tab).toBeUndefined()
    expect(result).toMatchObject({ taskId: "kid", delivered: true })
    expect(result).not.toHaveProperty("childTaskId")
    expect(client.requestNames).not.toContain("task.setCommand")
  })

  it("on a parent whose engine never started delivers to the parent itself and names it from the prompt", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", title: "(new task)" }) }),
      "tabs.get": () => ({ state: null, rev: 0 }),
      "task.rename": () => ({}),
      "task.setPrompt": () => ({}),
    })
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb("add", ["--parent", "abc", "--no-worktree", "--prompt", "Fix the login redirect"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(client.requestNames).not.toContain("task.spawn")
    expect(client.requestNames).not.toContain("task.create")
    expect(client.requests.find((r) => r.name === "task.rename")?.payload).toEqual({
      taskId: "abc",
      title: "Fix the login redirect",
    })
    expect(calls[0].target).toMatchObject({ id: "abc", firstConversation: true })
    expect(calls[0].target.tab).toBeUndefined()
    expect(result).toMatchObject({ taskId: "abc", delivered: true })
  })

  it("on a parent whose engine never started re-points its engine when --command differs", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", title: "Existing", command: "claude" }) }),
      "tabs.get": () => ({ state: null, rev: 0 }),
      "task.setCommand": () => ({}),
      "task.setPrompt": () => ({}),
    })
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("add", ["--parent", "abc", "--no-worktree", "--prompt", "hi", "--command", "codex"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(client.requestNames).not.toContain("task.spawn")
    expect(client.requests.find((r) => r.name === "task.setCommand")?.payload).toMatchObject({
      taskId: "abc",
      command: "codex",
    })
    expect(calls[0].target).toMatchObject({ id: "abc", firstConversation: true })
  })

  // Two concurrent calls on one parent would both claim its tab-1; the lock makes the second a child.
  it("two concurrent calls on an unstarted parent: the first takes the parent's conversation, the second becomes a child and keeps its prompt", async () => {
    let started = false
    const child = taskFixture({ id: "kid", parentTaskId: "abc", sharesWorkspaceOf: "abc" })
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", title: "(new task)" }) }),
      "tabs.get": () => ({
        state: { tabs: [{ kind: "engine", id: "tab-1", spawned: started }], activeId: "tab-1" },
        rev: 1,
      }),
      "task.list": () => ({ tasks: [] }),
      "task.rename": () => ({}),
      "task.setPrompt": () => ({}),
      "task.spawn": () => ({ taskId: "kid", task: child, parentDirty: false, sharedLinks: [] }),
    })
    const { calls, deliver } = recordingDelivery()
    // The first delivery holds the parent's conversation until the second call is in flight behind the lock.
    const firstEntered = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    let deliveries = 0
    const gatedDeliver: typeof deliver = async (c, target, prompt) => {
      if (deliveries++ === 0) {
        firstEntered.resolve()
        await releaseFirst.promise
      }
      const out = await deliver(c, target, prompt)
      started = true
      return out
    }
    const run = (prompt: string) =>
      invokeVerb("add", ["--parent", "abc", "--no-worktree", "--prompt", prompt], {
        client,
        runtime: stubRuntime({ deliverPrompt: gatedDeliver }),
      })
    const first = run("first")
    await firstEntered.promise
    const second = run("second")
    releaseFirst.resolve()
    const results = (await Promise.all([first, second])) as Array<{ taskId: string }>
    expect(calls.map((c) => c.prompt).sort()).toEqual(["first", "second"])
    expect(calls.map((c) => c.target.id).sort()).toEqual(["abc", "kid"])
    expect(results.map((r) => r.taskId).sort()).toEqual(["abc", "kid"])
    expect(client.requests.filter((r) => r.name === "task.spawn")).toHaveLength(1)
  })

  describe("reply address", () => {
    it("from a verified rove session records that session as the child's dispatcher", async () => {
      await asSender()
      const client = startedParentClient()
      await invokeVerb("add", ["--parent", "abc", "--no-worktree", "--prompt", "hi"], {
        client,
        runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
      })
      expect(client.requests.find((r) => r.name === "task.spawn")?.payload).toMatchObject({
        parentTaskId: "abc",
        dispatcherTaskId: "sender-1",
        dispatcherTabId: "tab-1",
      })
    })

    it("--no-dispatcher records none and sends the prompt without a [ROVE PEER] header", async () => {
      await asSender()
      const client = startedParentClient()
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("add", ["--parent", "abc", "--no-worktree", "--no-dispatcher", "--prompt", "hi"], {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      const payload = client.requests.find((r) => r.name === "task.spawn")?.payload
      expect(payload).not.toHaveProperty("dispatcherTaskId")
      expect(payload).not.toHaveProperty("dispatcherTabId")
      expect(calls[0].prompt).not.toContain("[ROVE PEER]")
    })
  })
})
