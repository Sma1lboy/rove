/**
 * A routine turn reports only when something happened: one that ends unreported is `quiet` (no
 * Inbox row, no hold on the next run), and a routine turn that did report raises no `turn_complete`
 * row. Non-routine deliveries keep `report_missing`. Through the real `engine.reportEvent` handler.
 */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DeliveriesStore } from "../../../rove-daemon/src/daemon/deliveries-store.ts"
import { evaluateRunnability } from "../../../rove-daemon/src/daemon/runnability.ts"
import { dispatch, fakeCtx } from "./handler-test-context.ts"

const TASK = "t1"
const TAB = "tab-1"

async function harness() {
  const deliveries = new DeliveriesStore(join(mkdtempSync(join(tmpdir(), "rove-quiet-turn-")), "deliveries.json"))
  await deliveries.init()
  const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === TASK ? { id } : undefined) })
  const missingRows: string[] = []
  Object.assign(ctx, { deliveries })
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
  const arm = (source: "routine" | "send") => deliveries.arm({ taskId: TASK, tabId: TAB, source, promptHead: "tick" })
  return { deliveries, turn, turnCompleteRows, missingRows, verdict, arm }
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
