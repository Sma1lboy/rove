/**
 * The Routines row's "last failed" line: a precheck that finds nothing to do is the routine working,
 * not a failure; a dispatch error, a firing held on an unreported tick, or a delivery its engine
 * ended with no report is.
 */

import { describe, expect, it } from "vitest"
import type { AutomationRun } from "../../../rove-daemon/src/daemon/contracts.ts"
import type { Delivery } from "../../../rove-daemon/src/daemon/delivery-contracts.ts"
import { lastRoutineFailure } from "../../../rove-daemon/src/daemon/delivery-ops.ts"

const run = (n: number, fields: Partial<AutomationRun>): AutomationRun => ({
  id: `r${n}`,
  automationId: "a",
  runNumber: n,
  scheduledFor: `2026-11-01T0${n}:00:00.000Z`,
  at: `2026-11-01T0${n}:00:01.000Z`,
  trigger: "scheduled",
  status: "dispatched",
  ...fields,
})

const deliveries = (byId: Record<string, Partial<Delivery>>) => ({
  get: (id: string) => byId[id] as Delivery | undefined,
})

describe("lastRoutineFailure", () => {
  it("a precheck skip or a busy skip is not a failure", () => {
    const runs = [
      run(3, { status: "skipped_precheck", error: "precheck exited 1" }),
      run(2, { status: "skipped_blocked", blocked: { run: false, reason: "busy" }, error: "busy" }),
    ]
    expect(lastRoutineFailure(runs, deliveries({}))).toBeUndefined()
  })

  it("names the newest failure behind later quiet runs", () => {
    const runs = [
      run(4, { status: "skipped_precheck", error: "precheck exited 1" }),
      run(3, { deliveryId: "d-3" }),
      run(2, { status: "dispatch_failed", error: "target engine exited" }),
    ]
    const failed = deliveries({
      "d-3": { missing: { cause: "transient-failure", note: "Unable to connect", at: "2026-11-01T03:05:00.000Z" } },
    })
    expect(lastRoutineFailure(runs, failed)).toEqual({
      at: "2026-11-01T03:05:00.000Z",
      reason: "transient-failure: Unable to connect",
    })
    expect(lastRoutineFailure(runs.slice(2), failed)).toEqual({ at: runs[2]?.at, reason: "target engine exited" })
  })

  it("a firing held on an unreported tick is one", () => {
    const held = run(1, {
      status: "skipped_blocked",
      blocked: { run: false, reason: "report-missing" },
      error: "report-missing: d-2 ended without a report (turn-failed)",
    })
    expect(lastRoutineFailure([held], deliveries({}))?.reason).toContain("report-missing")
  })
})
