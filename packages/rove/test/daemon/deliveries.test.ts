/**
 * Delivery reports end to end through the real stores and the real RPC
 * handlers: an armed prompt that ends without `rove api report` is flagged
 * `report_missing`, and a report (early, late, or via routine-respond) closes
 * the one record every surface reads.
 */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AttentionInboxStore } from "../../../rove-daemon/src/daemon/attention-inbox.ts"
import { runAutomationOnce } from "../../../rove-daemon/src/daemon/automation-runner.ts"
import { AutomationsStore } from "../../../rove-daemon/src/daemon/automations-store.ts"
import { DeliveriesStore } from "../../../rove-daemon/src/daemon/deliveries-store.ts"
import { DELIVERY_STALL_MS } from "../../../rove-daemon/src/daemon/delivery-contracts.ts"
import {
  type DeliveryDeps,
  markDeliveryMissing,
  reportDelivery,
  sweepStalledDeliveries,
  trackDeliveryTurn,
} from "../../../rove-daemon/src/daemon/delivery-ops.ts"
import { DaemonEventBus } from "../../../rove-daemon/src/daemon/event-bus.ts"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
} from "../../../rove-daemon/src/daemon/handlers.ts"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, recordingDelivery, stubRuntime } from "../cli/api-handler-fixtures.ts"
import { NOW, automation, fakeDeps } from "./automation-runner-fixtures.ts"

const TASK = "task-1"
const TAB = "tab-1"

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), "rove-deliveries-"))
  let clock = NOW
  const bus = new DaemonEventBus()
  const inbox = new AttentionInboxStore(join(dir, "attention-inbox.json"), bus, () => clock)
  await inbox.init()
  const deliveries = new DeliveriesStore(join(dir, "deliveries.json"), () => clock)
  await deliveries.init()
  const automations = new AutomationsStore(join(dir, "automations.json"), () => clock)
  await automations.init()
  const cardReports: Array<{ id: string; summary?: string }> = []
  const orch = {
    getTask: (id: string) => (id === TASK ? { id } : undefined),
    setWorkerReport: async (id: string, report: { summary?: string }) => {
      cardReports.push({ id, ...report })
    },
  }
  const deps = { deliveries, inbox, orch, automations, now: () => clock } as unknown as DeliveryDeps
  const ctx = { deliveries, inbox, orch, automations } as unknown as DaemonHandlerContext
  const registry = createDaemonHandlerRegistry()
  const rpc = (name: string, payload: Record<string, unknown>) => dispatchDaemonRequest(registry, name, payload, ctx)
  const rows = () => inbox.snapshot().filter((item) => item.state === "report_missing")
  return {
    dir,
    deliveries,
    inbox,
    automations,
    deps,
    rpc,
    rows,
    cardReports,
    advance: (ms: number) => {
      clock += ms
    },
    arm: () => deliveries.arm({ taskId: TASK, tabId: TAB, source: "send", promptHead: "do the thing" }),
  }
}

describe("a turn that ends without a report", () => {
  it("marks the delivery missing and files a report_missing Inbox row", async () => {
    const h = await harness()
    const d = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-complete", undefined)

    expect(h.deliveries.get(d.id)).toMatchObject({ status: "missing", missing: { cause: "turn-complete" } })
    expect(h.rows()).toEqual([
      expect.objectContaining({
        taskId: TASK,
        tabId: TAB,
        detail: { delivery: { id: d.id, cause: "turn-complete" } },
      }),
    ])
  })

  it("is not flagged when the report landed before the turn ended", async () => {
    const h = await harness()
    const d = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    await h.rpc("delivery.report", { deliveryId: d.id, outcome: "done", summary: "shipped", evidence: ["abc123"] })
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-complete", undefined)

    expect(h.deliveries.get(d.id)).toMatchObject({
      status: "reported",
      report: { outcome: "done", summary: "shipped", evidence: ["abc123"] },
    })
    expect(h.rows()).toEqual([])
    // The task card's own claim follows the report without a second call.
    expect(h.cardReports).toEqual([{ id: TASK, summary: "shipped" }])
  })

  it("ignores a Stop that belongs to the prompt this one queued behind", async () => {
    const h = await harness()
    const d = await h.arm()
    // No turn-start yet: the engine is still finishing an earlier prompt.
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-complete", undefined)
    expect(h.deliveries.get(d.id)?.status).toBe("awaiting")
    expect(h.rows()).toEqual([])
  })

  it("flags a failed turn even though no turn ever started, carrying the failure as the note", async () => {
    const h = await harness()
    const d = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-failed", { failure: "other", note: "API Error: 400" })

    expect(h.deliveries.get(d.id)).toMatchObject({
      status: "missing",
      missing: { cause: "turn-failed", note: "API Error: 400" },
    })
    expect(h.rows()[0]?.detail).toMatchObject({ note: "API Error: 400" })
  })

  it("settles each queued delivery by its own turn: A's Stop leaves B for B's turn", async () => {
    const h = await harness()
    const a = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    h.advance(1000)
    // B is pasted while A runs, so it queues behind A.
    const b = await h.arm()

    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-complete", undefined)
    expect(h.deliveries.get(a.id)).toMatchObject({ status: "missing", missing: { cause: "turn-complete" } })
    expect(h.deliveries.get(b.id)?.status).toBe("awaiting")

    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-complete", undefined)
    expect(h.deliveries.get(b.id)).toMatchObject({ status: "missing", missing: { cause: "turn-complete" } })
    expect(h.rows().map((row) => row.detail?.delivery?.id)).toEqual([a.id, b.id])
  })

  it("two sends before any turn-start are begun and ended in arming order", async () => {
    const h = await harness()
    const a = await h.arm()
    h.advance(1000)
    const b = await h.arm()

    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    expect(h.deliveries.get(a.id)?.turnStartedAt).toBeDefined()
    expect(h.deliveries.get(b.id)?.turnStartedAt).toBeUndefined()

    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-complete", undefined)
    expect(h.deliveries.get(a.id)?.status).toBe("missing")
    expect(h.deliveries.get(b.id)?.status).toBe("awaiting")
  })

  it("a failed turn ends the started delivery before a queued one", async () => {
    const h = await harness()
    const a = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    h.advance(1000)
    const b = await h.arm()

    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-failed", { failure: "other" })
    expect(h.deliveries.get(a.id)?.status).toBe("missing")
    expect(h.deliveries.get(b.id)?.status).toBe("awaiting")
  })

  it.each([
    ["turn-interrupted", "interrupted"],
    ["session-end", "session-end"],
  ] as const)("a %s ends the started delivery with cause %s", async (kind, cause) => {
    const h = await harness()
    const d = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, kind, undefined)
    expect(h.deliveries.get(d.id)?.status).toBe("awaiting")

    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    await trackDeliveryTurn(h.deps, TASK, TAB, kind, undefined)
    expect(h.deliveries.get(d.id)).toMatchObject({ status: "missing", missing: { cause } })
    expect(h.rows()).toHaveLength(1)
  })

  it("a rate-limited failure marks the delivery without an Inbox row, and a late report still lands", async () => {
    const h = await harness()
    const d = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-failed", { failure: "rate_limit" })

    expect(h.deliveries.get(d.id)).toMatchObject({ status: "missing", missing: { cause: "rate-limited" } })
    expect(h.rows()).toEqual([])

    await reportDelivery(h.deps, d.id, { outcome: "done", summary: "resumed and finished" })
    expect(h.deliveries.get(d.id)?.status).toBe("reported")
  })
})

describe("the report_missing row", () => {
  it("survives the tab's next turn-start and is cleared by a late report", async () => {
    const h = await harness()
    const d = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-complete", undefined)

    // The owner (or a scheduler) types into the tab: per-tab episodes reset.
    await h.inbox.record(TASK, "turn-start", undefined, TAB)
    expect(h.rows()).toHaveLength(1)

    await h.rpc("delivery.report", { deliveryId: d.id, outcome: "partial", summary: "got halfway" })
    expect(h.deliveries.get(d.id)?.status).toBe("reported")
    expect(h.rows()).toEqual([])
  })

  it("is dismissed by delivery id, which leaves a tab episode on the same tab alone", async () => {
    const h = await harness()
    const d = await h.arm()
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-start", undefined)
    await trackDeliveryTurn(h.deps, TASK, TAB, "turn-complete", undefined)
    await h.inbox.record(TASK, "turn-complete", undefined, TAB)

    const ctx = { inbox: h.inbox } as unknown as DaemonHandlerContext
    await dispatchDaemonRequest(
      createDaemonHandlerRegistry(),
      "attention.dismiss",
      { taskId: TASK, deliveryId: d.id },
      ctx,
    )

    expect(h.rows()).toEqual([])
    expect(h.inbox.snapshot().map((item) => item.state)).toEqual(["turn_complete"])
    // Dismissing is "seen, carry on": the delivery stays missing.
    expect(h.deliveries.get(d.id)?.status).toBe("missing")
  })
})

describe("stall sweep across deliveries and restarts", () => {
  it("flags only the stale delivery, not a fresh one on the same tab", async () => {
    const h = await harness()
    const stale = await h.arm()
    h.advance(DELIVERY_STALL_MS + 1)
    const fresh = await h.arm()

    await sweepStalledDeliveries(h.deps, { stateOf: () => "idle" })
    expect(h.deliveries.get(stale.id)?.status).toBe("missing")
    expect(h.deliveries.get(fresh.id)?.status).toBe("awaiting")
  })

  it("measures the window from daemon boot, so a restart does not flag work in flight", async () => {
    const h = await harness()
    const d = await h.arm()
    h.advance(DELIVERY_STALL_MS * 2)
    const bootedAt = NOW + DELIVERY_STALL_MS * 2
    const unknown = { stateOf: () => undefined }

    await sweepStalledDeliveries(h.deps, unknown, bootedAt)
    expect(h.deliveries.get(d.id)?.status).toBe("awaiting")

    h.advance(DELIVERY_STALL_MS + 1)
    await sweepStalledDeliveries(h.deps, unknown, bootedAt)
    expect(h.deliveries.get(d.id)).toMatchObject({ status: "missing", missing: { cause: "stalled" } })
  })
})

describe("stall sweep", () => {
  it("marks an armed delivery missing once its tab has stopped working for 10 minutes", async () => {
    const h = await harness()
    const d = await h.arm()
    const idle = { stateOf: () => "idle" }

    await sweepStalledDeliveries(h.deps, idle)
    expect(h.deliveries.get(d.id)?.status).toBe("awaiting")

    h.advance(DELIVERY_STALL_MS + 1)
    await sweepStalledDeliveries(h.deps, idle)
    expect(h.deliveries.get(d.id)).toMatchObject({ status: "missing", missing: { cause: "stalled" } })
    expect(h.rows()).toHaveLength(1)
  })

  it.each(["running", "permission_needed"])("leaves a delivery alone while the tab is %s", async (state) => {
    const h = await harness()
    const d = await h.arm()
    h.advance(DELIVERY_STALL_MS * 3)
    await sweepStalledDeliveries(h.deps, { stateOf: () => state })
    expect(h.deliveries.get(d.id)?.status).toBe("awaiting")
    expect(h.rows()).toEqual([])
  })
})

describe("an engine death", () => {
  it("ends every delivery pinned to that tab, but not a paste still headed to an unpinned tab", async () => {
    const h = await harness()
    const pinned = await h.arm()
    h.advance(1000)
    const queued = await h.arm()
    const unpinned = await h.deliveries.arm({ taskId: TASK, tabId: null, source: "send", promptHead: "new tab" })
    const death = { taskId: TASK, cause: "engine-dead", scope: "all", exactTab: true } as const

    await markDeliveryMissing(h.deps, { ...death, tabId: "tab-9" })
    expect(h.deliveries.get(pinned.id)?.status).toBe("awaiting")
    expect(h.deliveries.get(unpinned.id)?.status).toBe("awaiting")

    await markDeliveryMissing(h.deps, { ...death, tabId: TAB, note: "exit 1" })
    expect(h.deliveries.get(pinned.id)).toMatchObject({
      status: "missing",
      missing: { cause: "engine-dead", note: "exit 1" },
    })
    expect(h.deliveries.get(queued.id)?.status).toBe("missing")
    expect(h.deliveries.get(unpinned.id)?.status).toBe("awaiting")
  })
})

describe("deliveries.json", () => {
  it("keeps the newest 50 per task and never reissues an id after a restart", async () => {
    const h = await harness()
    for (let i = 0; i < 52; i++) await h.arm()
    const kept = h.deliveries.listForTask(TASK)
    expect(kept).toHaveLength(50)
    expect(kept[0]?.id).toBe("d-52")

    const reloaded = new DeliveriesStore(join(h.dir, "deliveries.json"))
    await reloaded.init()
    expect((await reloaded.arm({ taskId: TASK, tabId: TAB, source: "send", promptHead: "x" })).id).toBe("d-53")
  })

  it("re-reporting replaces the earlier report", async () => {
    const h = await harness()
    const d = await h.arm()
    await reportDelivery(h.deps, d.id, { outcome: "failed", summary: "first" })
    await reportDelivery(h.deps, d.id, { outcome: "done", summary: "second", evidence: ["pr/1"] })
    expect(h.deliveries.get(d.id)?.report).toMatchObject({ outcome: "done", summary: "second", evidence: ["pr/1"] })
  })
})

describe("routine runs", () => {
  it("arm a delivery whose report IS the run's response, whichever verb wrote it", async () => {
    const h = await harness()
    const { deps } = fakeDeps({ store: h.automations })
    const a = await h.automations.create(automation())
    await runAutomationOnce({ ...deps, deliveries: h.deliveries }, a, { scheduledFor: NOW, trigger: "manual" })
    const run = h.automations.runsFor(a.id)[0]
    expect(run?.deliveryId).toBeDefined()
    expect(h.deliveries.get(run?.deliveryId as string)).toMatchObject({ source: "routine", automationRunId: run?.id })

    const runs = async () =>
      (
        (await h.rpc("automation.runs", { id: a.id })) as {
          runs: Array<{ response?: unknown; deliveryStatus?: string }>
        }
      ).runs
    expect((await runs())[0]).toMatchObject({ deliveryStatus: "awaiting" })
    expect((await runs())[0]?.response).toBeUndefined()

    await h.rpc("automation.respond", { runId: run?.id, text: "audit clean" })
    expect(h.deliveries.get(run?.deliveryId as string)).toMatchObject({
      status: "reported",
      report: { outcome: "done", summary: "audit clean" },
    })
    expect((await runs())[0]).toMatchObject({ deliveryStatus: "reported", response: { text: "audit clean" } })

    await h.rpc("delivery.report", { deliveryId: run?.deliveryId, outcome: "blocked", summary: "needs a decision" })
    expect((await runs())[0]).toMatchObject({ response: { text: "needs a decision" } })
    expect(h.deliveries.listForTask("task-1")).toHaveLength(1)
  })

  it("never leave a delivery behind for a firing that delivered nothing", async () => {
    const h = await harness()
    const { deps } = fakeDeps({
      store: h.automations,
      start: async () => ({ started: false, error: "engine never started" }),
    })
    const a = await h.automations.create(automation())
    await runAutomationOnce({ ...deps, deliveries: h.deliveries }, a, { scheduledFor: NOW, trigger: "manual" })
    expect(h.automations.runsFor(a.id)[0]).toMatchObject({ status: "dispatch_failed" })
    expect(h.automations.runsFor(a.id)[0]?.deliveryId).toBeUndefined()
    expect(h.deliveries.allAwaiting()).toEqual([])
  })
})

describe("delivery.settle", () => {
  it("drops a delivery whose paste never landed, and pins the tab of one that did", async () => {
    const h = await harness()
    const failed = (await h.rpc("delivery.arm", { taskId: TASK, promptHead: "p" })) as { deliveryId: string }
    await h.rpc("delivery.settle", { deliveryId: failed.deliveryId, delivered: false })
    expect(h.deliveries.get(failed.deliveryId)).toBeUndefined()

    const landed = (await h.rpc("delivery.arm", { taskId: TASK, promptHead: "p" })) as { deliveryId: string }
    await h.rpc("delivery.settle", { deliveryId: landed.deliveryId, delivered: true, tabId: "tab-3" })
    expect(h.deliveries.get(landed.deliveryId)).toMatchObject({ status: "awaiting", tabId: "tab-3" })
  })
})

describe("add --require-report with a first prompt", () => {
  it("arms the prompt, and a turn that ends without a report leaves the delivery missing", async () => {
    const h = await harness()
    const task = { id: TASK, repo: "/repo/x", worktreePath: "/wt/x", kind: "task", vendor: "claude" }
    const client = new FakeClient({
      "task.create": () => ({ taskId: TASK, task }),
      "task.requireReport": () => ({}),
      "task.get": () => ({ task: { ...task, requireReport: true } }),
      "task.setPrompt": () => ({}),
      "delivery.arm": (payload) => h.rpc("delivery.arm", payload as Record<string, unknown>),
      "delivery.settle": (payload) => h.rpc("delivery.settle", payload as Record<string, unknown>),
    })
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "ship it", "--require-report"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })

    expect(calls[0]?.prompt).toMatch(/ship it\n\n\[ROVE\] When this turn ends, report: .* report --delivery d-1 /)
    expect(h.deliveries.get("d-1")).toMatchObject({ status: "awaiting", tabId: "tab-1", source: "send" })

    await trackDeliveryTurn(h.deps, TASK, "tab-1", "turn-start", undefined)
    await trackDeliveryTurn(h.deps, TASK, "tab-1", "turn-complete", undefined)
    expect(h.deliveries.get("d-1")?.status).toBe("missing")
    expect(h.rows()).toHaveLength(1)
  })

  it("an add without the flag arms nothing, and a failed spawn drops the delivery", async () => {
    const h = await harness()
    const task = { id: TASK, repo: "/repo/x", worktreePath: "/wt/x", kind: "task", vendor: "claude" }
    const responders = {
      "task.create": () => ({ taskId: TASK, task }),
      "task.get": () => ({ task }),
      "task.setPrompt": () => ({}),
      "delivery.arm": (payload: unknown) => h.rpc("delivery.arm", payload as Record<string, unknown>),
      "delivery.settle": (payload: unknown) => h.rpc("delivery.settle", payload as Record<string, unknown>),
    }
    const plain = recordingDelivery()
    await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "hi"], {
      client: new FakeClient(responders),
      runtime: stubRuntime({ deliverPrompt: plain.deliver }),
    })
    expect(plain.calls[0]?.prompt).toBe("hi")
    expect(h.deliveries.listForTask(TASK)).toEqual([])

    await expect(
      invokeVerb("add", ["--repo", "/repo/x", "--prompt", "hi", "--expect-report"], {
        client: new FakeClient({ ...responders, "task.requireReport": () => ({}) }),
        runtime: stubRuntime({ deliverPrompt: recordingDelivery({ delivered: false }).deliver }),
      }),
    ).rejects.toThrow()
    expect(h.deliveries.listForTask(TASK)).toEqual([])
  })
})
