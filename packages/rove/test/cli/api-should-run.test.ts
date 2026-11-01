/** `should-run`, `send --if-runnable` and the `runnability` field: the CLI side of the should-run verdict. */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const savedEnv = { taskId: process.env.ROVE_TASK_ID, tabId: process.env.ROVE_TAB_ID }
beforeEach(() => {
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.ROVE_TASK_ID
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.ROVE_TAB_ID
})
afterEach(() => {
  for (const [name, value] of [
    ["ROVE_TASK_ID", savedEnv.taskId],
    ["ROVE_TAB_ID", savedEnv.tabId],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const BUSY = { run: false, reason: "busy", detail: "a turn is running" }

/** The error `runApiSubcommand` turns into "payload on stdout, exit 3". */
async function skipped(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe("SKIPPED")
    return (error as ApiError).data as Record<string, unknown>
  }
  return expect.unreachable("should have been skipped")
}

describe("should-run", () => {
  it("prints the verdict for a runnable task", async () => {
    const client = new FakeClient({ "task.runnability": () => ({ run: true }) })
    expect(await invokeVerb("should-run", ["--task-id", "t1"], { client, runtime: stubRuntime() })).toEqual({
      run: true,
    })
    expect(client.requests[0]).toEqual({ name: "task.runnability", payload: { taskId: "t1" } })
  })

  it("a skip carries the whole verdict out as the exit-3 payload", async () => {
    const client = new FakeClient({ "task.runnability": () => BUSY })
    const payload = await skipped(() =>
      invokeVerb("should-run", ["--task-id", "t1", "--tab", "tab-2"], { client, runtime: stubRuntime() }),
    )
    expect(payload).toEqual(BUSY)
    expect(client.requests[0]?.payload).toEqual({ taskId: "t1", tabId: "tab-2" })
  })

  it("refuses a malformed --tab before asking the daemon", async () => {
    const client = new FakeClient({})
    await expectApiError(
      () => invokeVerb("should-run", ["--task-id", "t1", "--tab", "bogus"], { client, runtime: stubRuntime() }),
      "BAD_TAB",
    )
    expect(client.requests).toEqual([])
  })
})

describe("send --if-runnable", () => {
  function sendClient(admit: () => Record<string, unknown>, task: Record<string, unknown> = {}) {
    return new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "t1", ...task }) }),
      "send.admit": admit,
      "send.release": () => ({}),
      "delivery.settle": () => ({ cancelled: false }),
    })
  }
  /** Only the claim/delivery traffic; `send` also reads the task, gates and activity. */
  const names = (client: FakeClient) =>
    client.requests
      .map((r) => r.name)
      .filter((n) => n !== "send.check" && (n.startsWith("send.") || n.startsWith("delivery.")))

  it("a refused tick pastes nothing and exits through the skip payload", async () => {
    const client = sendClient(() => ({ skipped: BUSY }))
    const { calls, deliver } = recordingDelivery()
    const payload = await skipped(() =>
      invokeVerb("send", ["--task-id", "t1", "--prompt", "tick", "--plain", "--if-runnable"], {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      }),
    )
    expect(payload).toMatchObject({ taskId: "t1", skipped: BUSY })
    expect(calls).toEqual([])
    expect(names(client)).toEqual(["send.admit"])
  })

  it("reports the skipped delivery's id when the daemon recorded one", async () => {
    const client = sendClient(() => ({ skipped: BUSY, deliveryId: "d-3" }))
    const payload = await skipped(() =>
      invokeVerb("send", ["--task-id", "t1", "--prompt", "tick", "--plain", "--if-runnable", "--expect-report"], {
        client,
        runtime: stubRuntime(),
      }),
    )
    expect(payload).toMatchObject({ deliveryId: "d-3" })
    expect(client.requests.find((r) => r.name === "send.admit")?.payload).toMatchObject({ expectReport: true })
  })

  it("an admitted tick pastes, then releases its claim as landed", async () => {
    const client = sendClient(() => ({ claimId: "c-1" }))
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb("send", ["--task-id", "t1", "--prompt", "tick", "--plain", "--if-runnable"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(calls[0]?.prompt).toBe("tick")
    expect(result).toMatchObject({ ok: true })
    expect(result).not.toHaveProperty("deliveryId")
    expect(client.requests.find((r) => r.name === "send.release")?.payload).toEqual({
      claimId: "c-1",
      delivered: true,
    })
    // The daemon arms inside admit; the CLI must not arm a second delivery.
    expect(names(client)).not.toContain("delivery.arm")
  })

  it("uses the delivery the daemon armed in admit for the report footer", async () => {
    const client = sendClient(() => ({ claimId: "c-1", deliveryId: "d-9" }))
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb(
      "send",
      ["--task-id", "t1", "--prompt", "tick", "--plain", "--if-runnable", "--expect-report"],
      { client, runtime: stubRuntime({ deliverPrompt: deliver }) },
    )
    expect(calls[0]?.prompt).toContain("report --delivery d-9")
    expect(result).toMatchObject({ deliveryId: "d-9" })
  })

  it("a paste that never landed frees the claim at once", async () => {
    const client = sendClient(() => ({ claimId: "c-1" }))
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "t1", "--prompt", "tick", "--plain", "--if-runnable"], {
          client,
          runtime: stubRuntime({ deliverPrompt: recordingDelivery({ delivered: false }).deliver }),
        }),
      "NOT_DELIVERED",
    )
    expect(client.requests.find((r) => r.name === "send.release")?.payload).toEqual({
      claimId: "c-1",
      delivered: false,
    })
  })

  it("without the flag, no admit round-trip happens", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "t1" }) }) })
    await invokeVerb("send", ["--task-id", "t1", "--prompt", "hi", "--plain"], {
      client,
      runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
    })
    expect(names(client)).toEqual([])
  })
})

describe("runnability on reads", () => {
  it("get-task carries the verdict a scheduler would act on", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "t1" }) }),
      "task.runnability": () => BUSY,
    })
    const result = (await invokeVerb("get-task", ["--task-id", "t1"], { client, runtime: stubRuntime() })) as Record<
      string,
      unknown
    >
    expect(result.runnability).toEqual(BUSY)
  })

  it("get-task still answers against a daemon that predates the verdict", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "t1" }) }) })
    const result = (await invokeVerb("get-task", ["--task-id", "t1"], { client, runtime: stubRuntime() })) as Record<
      string,
      unknown
    >
    expect(result).not.toHaveProperty("runnability")
  })
})
