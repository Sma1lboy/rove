/**
 * `send` targeting an archived task: delivery stays allowed, the reply carries
 * `archived: true` + a one-line `warning` across every targeting path, `--unarchive`
 * restores the task (and descendants) before delivering, and an archived `[ROVE PEER]`
 * sender leaves a non-archived recipient's reply unchanged.
 */

import { invokeVerb } from "@sma1lboy/rove-api/cli/api-cmd.ts"
import { resetVerifiedSelfSession, verifiedSelfSession } from "@sma1lboy/rove-api/cli/api/dispatcher.ts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const savedEnv = { taskId: process.env.ROVE_TASK_ID, tabId: process.env.ROVE_TAB_ID }

beforeEach(() => {
  resetVerifiedSelfSession()
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.ROVE_TASK_ID
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.ROVE_TAB_ID
})

afterEach(() => {
  resetVerifiedSelfSession()
  for (const [name, value] of [
    ["ROVE_TASK_ID", savedEnv.taskId],
    ["ROVE_TAB_ID", savedEnv.tabId],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

async function asSession(taskId: string, tabId = "tab-1"): Promise<void> {
  process.env.ROVE_TASK_ID = taskId
  process.env.ROVE_TAB_ID = tabId
  await verifiedSelfSession(
    { ROVE_TASK_ID: taskId, ROVE_TAB_ID: tabId },
    {
      pid: 500,
      sessions: async () => [{ key: `${taskId}::${tabId}`, pid: 100, alive: true }],
      ps: async () => "  100     1 /bin/zsh -il\n  500   100 bun rove api send",
    },
  )
}

describe("send to an archived task", () => {
  it("delivers and warns with archived:true when the target task is archived", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "t-arch", archived: true }) }) })
    const restarted = recordingDelivery({ started: true })
    const res1 = (await invokeVerb("send", ["--task-id", "t-arch", "--prompt", "hi"], {
      client,
      runtime: stubRuntime({ deliverPrompt: restarted.deliver }),
    })) as Record<string, unknown>
    expect(restarted.calls).toHaveLength(1)
    expect(res1.archived).toBe(true)
    expect(res1.warning).toBe(
      "task t-arch is archived: the message was delivered and its engine restarted, but the task stays hidden; pass --unarchive to bring it back",
    )

    // Already-running engine (second send to the still-archived task) does not claim an engine restart.
    const existing = recordingDelivery({ started: false })
    const res2 = (await invokeVerb("send", ["--task-id", "t-arch", "--prompt", "again"], {
      client,
      runtime: stubRuntime({ deliverPrompt: existing.deliver }),
    })) as Record<string, unknown>
    expect(res2.archived).toBe(true)
    expect(res2.warning).toBe(
      "task t-arch is archived: the message was delivered, but the task stays hidden; pass --unarchive to bring it back",
    )
  })

  it("leaves the reply unchanged when the target task is not archived", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "t-live" }) }) })
    const res = (await invokeVerb("send", ["--task-id", "t-live", "--prompt", "hi"], {
      client,
      runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
    })) as Record<string, unknown>
    expect(res.archived).toBeUndefined()
    expect(res.warning).toBeUndefined()
    expect(res.unarchived).toBeUndefined()
  })

  it("reports archived:true across active-task, --tab, and dispatcher-reply paths", async () => {
    // Plain send via active task.
    const activeClient = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "t-active", archived: true }) }),
    })
    activeClient.replay.push({ channel: "active-task", payload: { taskId: "t-active" } })
    const activeRes = (await invokeVerb("send", ["--prompt", "hi"], {
      client: activeClient,
      runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
    })) as Record<string, unknown>
    expect(activeRes).toMatchObject({ archived: true, warning: expect.stringContaining("task t-active is archived") })

    // Explicit --tab path.
    const tabRes = (await invokeVerb("send", ["--task-id", "t-active", "--tab", "tab-2", "--prompt", "hi"], {
      client: activeClient,
      runtime: stubRuntime({ deliverPrompt: recordingDelivery({ started: false }).deliver }),
    })) as Record<string, unknown>
    expect(tabRes).toMatchObject({ archived: true, warning: expect.stringContaining("task t-active is archived") })

    // Dispatcher-reply path (bare send from a worker whose dispatcher task is archived).
    await asSession("worker-1", "tab-1")
    const dispClient = new FakeClient({
      "task.get": (payload) => {
        const id = (payload as { taskId: string }).taskId
        if (id === "worker-1") {
          return { task: taskFixture({ id, dispatcher: { taskId: "disp-arch", tabId: "tab-1" } }) }
        }
        return { task: taskFixture({ id, archived: true }) }
      },
    })
    const dispRes = (await invokeVerb("send", ["--prompt", "done"], {
      client: dispClient,
      runtime: stubRuntime({
        deliverPrompt: recordingDelivery({ started: false }).deliver,
        taskTabs: async () => ({
          tabs: [{ id: "tab-1", kind: "engine", alive: true } as never],
          running: true,
        }),
      }),
    })) as Record<string, unknown>
    expect(dispRes).toMatchObject({ archived: true, warning: expect.stringContaining("task disp-arch is archived") })
  })

  it("peer-to-peer: archived sender to live target is unchanged; live sender to archived target warns", async () => {
    await asSession("sender-arch", "tab-1")
    const client = new FakeClient({
      "task.get": (payload) => {
        const id = (payload as { taskId: string }).taskId
        return { task: taskFixture({ id, archived: id === "sender-arch" || id === "target-arch" }) }
      },
    })
    const toLive = recordingDelivery()
    const liveRes = (await invokeVerb("send", ["--task-id", "target-live", "--prompt", "ping"], {
      client,
      runtime: stubRuntime({ deliverPrompt: toLive.deliver }),
    })) as Record<string, unknown>
    expect(toLive.calls[0].prompt).toContain("[ROVE PEER] from task sender-arch")
    expect(liveRes.archived).toBeUndefined()
    expect(liveRes.warning).toBeUndefined()

    const toArch = recordingDelivery()
    const archRes = (await invokeVerb("send", ["--task-id", "target-arch", "--prompt", "ping"], {
      client,
      runtime: stubRuntime({ deliverPrompt: toArch.deliver }),
    })) as Record<string, unknown>
    expect(toArch.calls[0].prompt).toContain("[ROVE PEER] from task sender-arch")
    expect(archRes).toMatchObject({ archived: true, warning: expect.stringContaining("task target-arch is archived") })
  })

  it("--unarchive restores via task.archive before delivering and omits archived/warning", async () => {
    const order: string[] = []
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "t-arch", archived: true }) }),
      "task.archive": (payload) => {
        order.push("task.archive")
        return { archived: ["child-1", (payload as { taskId: string }).taskId] }
      },
    })
    const res = (await invokeVerb("send", ["--task-id", "t-arch", "--unarchive", "--prompt", "wake up"], {
      client,
      runtime: stubRuntime({
        deliverPrompt: async (_client, target, prompt) => {
          order.push("deliverPrompt")
          return {
            session: `${target.id}::tab-1`,
            pane: `${target.id}::tab-1`,
            started: true,
            engineReady: true,
            delivered: true,
            bytes: prompt.length,
          }
        },
      }),
    })) as Record<string, unknown>
    expect(order).toEqual(["task.archive", "deliverPrompt"])
    expect(client.requests.find((r) => r.name === "task.archive")?.payload).toEqual({
      taskId: "t-arch",
      archived: false,
      force: false,
    })
    expect(res.unarchived).toBe(true)
    expect(res.archived).toBeUndefined()
    expect(res.warning).toBeUndefined()
  })

  it("--queue on an archived task reports archived:true + warning, and --unarchive restores it", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "t-arch", archived: true }) }),
      "queue.add": () => ({ queued: true, item: { id: "q-1", tabId: "tab-1" }, position: 1 }),
      "task.archive": () => ({ archived: ["t-arch"] }),
    })
    const held = (await invokeVerb("send", ["--task-id", "t-arch", "--tab", "tab-1", "--queue", "--prompt", "next"], {
      client,
      runtime: stubRuntime(),
    })) as Record<string, unknown>
    expect(held).toMatchObject({
      queued: true,
      archived: true,
      warning:
        "task t-arch is archived: the message was queued, but the task stays hidden; pass --unarchive to bring it back",
    })

    const restored = (await invokeVerb(
      "send",
      ["--task-id", "t-arch", "--tab", "tab-1", "--queue", "--unarchive", "--prompt", "next"],
      { client, runtime: stubRuntime() },
    )) as Record<string, unknown>
    expect(restored).toMatchObject({ queued: true, unarchived: true })
    expect(restored.archived).toBeUndefined()
    expect(restored.warning).toBeUndefined()
  })

  it("--unarchive conflicts with --repo and does not run when --if-runnable skips", async () => {
    await expectApiError(
      () =>
        invokeVerb("send", ["--repo", "/repo/x", "--unarchive", "--prompt", "hi"], {
          client: new FakeClient(),
          runtime: stubRuntime(),
        }),
      "CONFLICTING_FLAGS",
    )

    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "t-arch", archived: true }) }),
      "send.admit": () => ({ skipped: { run: false, reason: "busy" } }),
    })
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "t-arch", "--if-runnable", "--unarchive", "--prompt", "hi"], {
          client,
          runtime: stubRuntime(),
        }),
      "SKIPPED",
    )
    expect(client.requestNames).not.toContain("task.archive")
  })
})
