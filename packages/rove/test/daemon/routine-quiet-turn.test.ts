/**
 * A routine turn reports only when something happened: one that ends unreported is `quiet` (no
 * Inbox row, no hold on the next run), and a routine turn that did report raises no `turn_complete`
 * row. Non-routine deliveries keep `report_missing`. Through the real `engine.reportEvent` handler.
 */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DeliveriesStore } from "@sma1lboy/rove-daemon/daemon/deliveries-store"
import { evaluateRunnability } from "@sma1lboy/rove-daemon/daemon/runnability"
import { describe, expect, it, vi } from "vitest"
import { dispatch, fakeCtx } from "./handler-test-context.ts"

const TASK = "t1"
const TAB = "tab-1"

async function harness(opts: { routineTask?: boolean; routine?: { persistentSession?: boolean } } = {}) {
  const deliveries = new DeliveriesStore(join(mkdtempSync(join(tmpdir(), "rove-quiet-turn-")), "deliveries.json"))
  await deliveries.init()
  const row = { id: TASK, ...(opts.routineTask ? { routine: { automationId: "a1" } } : {}) }
  const { ctx, rec } = fakeCtx({
    getTask: (id: string) => (id === TASK ? row : undefined),
    listTasks: () => [row],
    prepareTaskDeletion: async () => true,
  })
  const missingRows: string[] = []
  const stopped: string[] = []
  const settled: Array<{ run: string; status: string; said?: string }> = []
  if (opts.routine) {
    Object.assign(ctx.automations, {
      get: () => ({ id: "a1", ...opts.routine }),
      settleRun: async (run: string, d: { status: string; report?: { summary: string } }) => {
        settled.push({ run, status: d.status, ...(d.report ? { said: d.report.summary } : {}) })
      },
    })
  }
  Object.assign(ctx, {
    deliveries,
    runtime: {
      ...ctx.runtime,
      stopTaskEngineTab: async (taskId: string, tabId: string) => {
        stopped.push(`${taskId}::${tabId}`)
      },
    },
  })
  ctx.inbox.recordReportMissing = async (_t, _tab, delivery) => {
    missingRows.push(delivery.id)
  }
  const turn = async (kind: "turn-start" | "turn-complete") =>
    await dispatch("engine.reportEvent", { taskId: TASK, tabId: TAB, kind }, ctx)
  const turnCompleteRows = () => rec.inboxRecords.filter((r) => r.kind === "turn-complete").length
  const verdict = () =>
    evaluateRunnability(
      {
        orch: { getTask: () => ({ id: TASK }) as never },
        activity: { entryOf: () => ({ state: "turn_complete" }) },
        gates: { list: () => [] } as never,
        deliveries,
      },
      TASK,
      TAB,
    )
  const arm = (source: "routine" | "send") =>
    deliveries.arm({
      taskId: TASK,
      tabId: TAB,
      source,
      promptHead: "tick",
      ...(source === "routine" ? { automationRunId: "r1" } : {}),
    })
  return { deliveries, turn, turnCompleteRows, missingRows, verdict, arm, stopped, settled, deleted: rec.deletions }
}

describe("a routine turn that ends without a report", () => {
  it("is quiet: no Inbox row of either kind, and the next run is not held", async () => {
    const h = await harness()
    const d = await h.arm("routine")
    await h.turn("turn-start")
    await h.turn("turn-complete")

    expect(h.deliveries.get(d.id)?.status).toBe("quiet")
    expect(h.missingRows).toEqual([])
    expect(h.turnCompleteRows()).toBe(0)
    expect(h.verdict()).toEqual({ run: true })
  })

  it("a send delivery still raises report_missing and its turn_complete row, and holds the next tick", async () => {
    const h = await harness()
    const d = await h.arm("send")
    await h.turn("turn-start")
    await h.turn("turn-complete")

    expect(h.deliveries.get(d.id)?.status).toBe("missing")
    expect(h.missingRows).toEqual([d.id])
    expect(h.turnCompleteRows()).toBe(1)
    expect(h.verdict()).toMatchObject({ run: false, reason: "report-missing" })
  })
})

describe("a routine turn that reported", () => {
  it("raises no turn_complete row, while the owner's next unarmed turn on the tab still does", async () => {
    const h = await harness()
    const d = await h.arm("routine")
    await h.turn("turn-start")
    await h.deliveries.setReport(d.id, { outcome: "done", summary: "found two flaky tests", evidence: [] })
    await h.turn("turn-complete")
    expect(h.turnCompleteRows()).toBe(0)

    await h.turn("turn-start")
    await h.turn("turn-complete")
    expect(h.turnCompleteRows()).toBe(1)
  })
})

describe("the engine of a routine's own task", () => {
  it.each(["quiet", "reported"] as const)("is stopped once its %s turn ends", async (how) => {
    const h = await harness({ routineTask: true })
    const d = await h.arm("routine")
    await h.turn("turn-start")
    if (how === "reported") await h.deliveries.setReport(d.id, { outcome: "done", summary: "ok", evidence: [] })
    expect(h.stopped).toEqual([])
    await h.turn("turn-complete")
    expect(h.stopped).toEqual([`${TASK}::${TAB}`])
  })

  it("keeps running while another prompt still waits on the tab", async () => {
    const h = await harness({ routineTask: true })
    await h.arm("routine")
    await h.arm("send")
    await h.turn("turn-start")
    await h.turn("turn-complete")
    expect(h.stopped).toEqual([])
  })

  it("is left alone in a task the routine does not own (a routine bound to someone's tab)", async () => {
    const h = await harness()
    await h.arm("routine")
    await h.turn("turn-start")
    await h.turn("turn-complete")
    expect(h.stopped).toEqual([])
  })
})

describe("the task a routine started for one run", () => {
  it("is deleted once the run reports done, and the run keeps the report", async () => {
    const h = await harness({ routineTask: true, routine: {} })
    const d = await h.arm("routine")
    await h.turn("turn-start")
    await h.deliveries.setReport(d.id, { outcome: "done", summary: "12 shots changed", evidence: [] })
    await h.turn("turn-complete")

    await vi.waitFor(() => expect(h.deleted).toEqual([TASK]))
    expect(h.settled).toEqual([{ run: "r1", status: "reported", said: "12 shots changed" }])
  })

  it("is deleted after a quiet run too", async () => {
    const h = await harness({ routineTask: true, routine: {} })
    await h.arm("routine")
    await h.turn("turn-start")
    await h.turn("turn-complete")

    await vi.waitFor(() => expect(h.deleted).toEqual([TASK]))
    expect(h.settled).toEqual([{ run: "r1", status: "quiet" }])
  })

  it("stays when the run reported it is blocked: the owner still has to open it", async () => {
    const h = await harness({ routineTask: true, routine: {} })
    const d = await h.arm("routine")
    await h.turn("turn-start")
    await h.deliveries.setReport(d.id, { outcome: "blocked", summary: "needs a token", evidence: [] })
    await h.turn("turn-complete")

    expect(h.stopped).toEqual([`${TASK}::${TAB}`])
    expect(h.deleted).toEqual([])
  })

  it("stays when it is the routine's standing session", async () => {
    const h = await harness({ routineTask: true, routine: { persistentSession: true } })
    await h.arm("routine")
    await h.turn("turn-start")
    await h.turn("turn-complete")

    expect(h.stopped).toEqual([`${TASK}::${TAB}`])
    expect(h.deleted).toEqual([])
  })
})
