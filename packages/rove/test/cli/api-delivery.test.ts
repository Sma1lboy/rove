/** `send` arming, `report`, `deliveries`, and `--require-report`: the CLI side of the delivery contract. */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DELIVERY_SUMMARY_MAX_CHARS } from "@sma1lboy/rove-daemon/daemon/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

// Peer provenance keys off the caller's own env; unset it so the delivered text is exact.
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

function sendClient(task: Record<string, unknown> = {}) {
  return new FakeClient({
    "task.get": () => ({ task: taskFixture({ id: "t1", ...task }) }),
    "delivery.arm": () => ({ deliveryId: "d-7" }),
    "delivery.settle": () => ({ cancelled: false }),
  })
}

/** Only the delivery traffic; `send` also reads the activity registry. */
function deliveryCalls(client: FakeClient) {
  return client.requests.filter((r) => r.name.startsWith("delivery."))
}
describe("send --expect-report", () => {
  it("arms before the paste, appends the report footer, and pins the tab the paste landed in", async () => {
    const client = sendClient()
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb("send", ["--task-id", "t1", "--prompt", "do it", "--plain", "--expect-report"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })

    const calls_ = deliveryCalls(client)
    expect(calls_.map((r) => r.name)).toEqual(["delivery.arm", "delivery.settle"])
    expect(calls_[0]?.payload).toEqual({ taskId: "t1", promptHead: "do it" })
    expect(calls[0]?.prompt).toMatch(/^do it\n\n\[ROVE\] When this turn ends, report: .* report --delivery d-7 /)
    expect(calls_[1]?.payload).toEqual({ deliveryId: "d-7", delivered: true, tabId: "tab-1" })
    expect(result).toMatchObject({ ok: true, deliveryId: "d-7" })
  })

  it("is implied by the task's requireReport", async () => {
    const client = sendClient({ requireReport: true })
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "t1", "--prompt", "tick", "--plain"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(deliveryCalls(client).map((r) => r.name)).toContain("delivery.arm")
    expect(calls[0]?.prompt).toContain("report --delivery d-7")
  })

  it("an ordinary send never arms a delivery", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "t1" }) }) })
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb("send", ["--task-id", "t1", "--prompt", "hi", "--plain"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(deliveryCalls(client)).toEqual([])
    expect(calls[0]?.prompt).toBe("hi")
    expect(result).not.toHaveProperty("deliveryId")
  })

  it("drops the delivery when the paste never landed, so a failed send is not later flagged missing", async () => {
    const client = sendClient()
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "t1", "--prompt", "hi", "--expect-report"], {
          client,
          runtime: stubRuntime({ deliverPrompt: recordingDelivery({ delivered: false }).deliver }),
        }),
      "NOT_DELIVERED",
    )
    expect(deliveryCalls(client).at(-1)).toEqual({
      name: "delivery.settle",
      payload: { deliveryId: "d-7", delivered: false },
    })
  })
})

describe("report", () => {
  it("sends the outcome, summary, repeated evidence and next to the delivery", async () => {
    const client = new FakeClient({ "delivery.report": () => ({ delivery: { id: "d-7" } }) })
    await invokeVerb(
      "report",
      [
        "--delivery",
        "d-7",
        "--outcome",
        "done",
        "--summary",
        "shipped",
        "--evidence",
        "abc123",
        "--evidence",
        "pr/9",
        "--next",
        "watch CI",
      ],
      { client, runtime: stubRuntime() },
    )
    expect(client.requests[0]).toEqual({
      name: "delivery.report",
      payload: {
        deliveryId: "d-7",
        outcome: "done",
        summary: "shipped",
        evidence: ["abc123", "pr/9"],
        next: "watch CI",
      },
    })
  })

  it("--json takes the whole body, backticks intact", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "rove-report-")), "r.json")
    writeFileSync(
      file,
      JSON.stringify({ delivery: "d-7", outcome: "blocked", summary: "needs `x` $(y)", evidence: ["a"] }),
    )
    const client = new FakeClient({ "delivery.report": () => ({ delivery: { id: "d-7" } }) })
    await invokeVerb("report", ["--json", file], { client, runtime: stubRuntime() })
    expect(client.requests[0]?.payload).toEqual({
      deliveryId: "d-7",
      outcome: "blocked",
      summary: "needs `x` $(y)",
      evidence: ["a"],
    })
  })

  it("an unknown delivery is DELIVERY_NOT_FOUND", async () => {
    const client = new FakeClient({ "delivery.report": () => ({ delivery: null }) })
    await expectApiError(
      () =>
        invokeVerb("report", ["--delivery", "d-0", "--outcome", "done", "--summary", "x"], {
          client,
          runtime: stubRuntime(),
        }),
      "DELIVERY_NOT_FOUND",
    )
  })

  it("refuses a summary over the cap instead of truncating it", async () => {
    const client = new FakeClient()
    await expectApiError(
      () =>
        invokeVerb(
          "report",
          ["--delivery", "d-7", "--outcome", "done", "--summary", "x".repeat(DELIVERY_SUMMARY_MAX_CHARS + 1)],
          { client, runtime: stubRuntime() },
        ),
      "RESPONSE_TOO_LARGE",
    )
    expect(client.requests).toEqual([])
  })

  it("needs a delivery, an outcome and a summary", async () => {
    await expectApiError(
      () =>
        invokeVerb("report", ["--outcome", "done", "--summary", "x"], {
          client: new FakeClient(),
          runtime: stubRuntime(),
        }),
      "MISSING_FLAG",
    )
  })
})

describe("deliveries", () => {
  it("lists a task's deliveries, honoring --limit", async () => {
    const client = new FakeClient({ "delivery.list": () => ({ deliveries: [] }) })
    await invokeVerb("deliveries", ["--task-id", "t1", "--limit", "5"], { client, runtime: stubRuntime() })
    expect(client.requests[0]).toEqual({ name: "delivery.list", payload: { taskId: "t1", limit: 5 } })
  })
})

describe("--require-report", () => {
  it("update flips it per task", async () => {
    const client = new FakeClient({ "task.requireReport": () => ({}) })
    await invokeVerb("update", ["--task-id", "t1", "--require-report", "on"], { client, runtime: stubRuntime() })
    await invokeVerb("update", ["--task-id", "t1", "--require-report", "off"], { client, runtime: stubRuntime() })
    expect(client.requests.map((r) => r.payload)).toEqual([
      { taskId: "t1", required: true },
      { taskId: "t1", required: false },
    ])
  })
})
