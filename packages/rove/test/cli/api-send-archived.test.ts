/**
 * `send` to an archived task is refused with TASK_ARCHIVED on every targeting path: nothing is
 * delivered, queued or started. An archived `[ROVE PEER]` sender still reaches a live target.
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

function refusesWithoutDelivery(
  args: readonly string[],
  client: FakeClient,
  extra: Parameters<typeof stubRuntime>[0] = {},
): Promise<void> {
  const delivery = recordingDelivery()
  return expectApiError(
    () =>
      invokeVerb("send", [...args], { client, runtime: stubRuntime({ deliverPrompt: delivery.deliver, ...extra }) }),
    "TASK_ARCHIVED",
  ).then(() => {
    expect(delivery.calls).toHaveLength(0)
    expect(client.requestNames).not.toContain("queue.add")
  })
}

describe("send to an archived task", () => {
  it("is refused on --task-id, --tab, --queue and the active task", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "t-arch", archived: true }) }),
      "queue.add": () => ({ queued: true, item: { id: "q-1", tabId: "tab-1" }, position: 1 }),
    })
    client.replay.push({ channel: "active-task", payload: { taskId: "t-arch" } })
    await refusesWithoutDelivery(["--task-id", "t-arch", "--prompt", "hi"], client)
    await refusesWithoutDelivery(["--task-id", "t-arch", "--tab", "tab-2", "--prompt", "hi"], client)
    await refusesWithoutDelivery(["--task-id", "t-arch", "--tab", "tab-1", "--queue", "--prompt", "hi"], client)
    await refusesWithoutDelivery(["--prompt", "hi"], client)
  })

  it("is refused on the dispatcher reply when the dispatcher is archived", async () => {
    await asSession("worker-1", "tab-1")
    const client = new FakeClient({
      "task.get": (payload) => {
        const id = (payload as { taskId: string }).taskId
        if (id === "worker-1") return { task: taskFixture({ id, dispatcher: { taskId: "disp-arch", tabId: "tab-1" } }) }
        return { task: taskFixture({ id, archived: true }) }
      },
    })
    await refusesWithoutDelivery(["--prompt", "done"], client, {
      taskTabs: async () => ({ tabs: [{ id: "tab-1", kind: "engine", alive: true } as never], running: true }),
    })
  })

  it("peer-to-peer: an archived sender still reaches a live target; an archived target is refused", async () => {
    await asSession("sender-arch", "tab-1")
    const client = new FakeClient({
      "task.get": (payload) => {
        const id = (payload as { taskId: string }).taskId
        return { task: taskFixture({ id, archived: id === "sender-arch" || id === "target-arch" }) }
      },
    })
    const toLive = recordingDelivery()
    await invokeVerb("send", ["--task-id", "target-live", "--prompt", "ping"], {
      client,
      runtime: stubRuntime({ deliverPrompt: toLive.deliver }),
    })
    expect(toLive.calls[0].prompt).toContain("[ROVE PEER] from task sender-arch")
    await refusesWithoutDelivery(["--task-id", "target-arch", "--prompt", "ping"], client)
  })
})
