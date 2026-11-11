import { describe, expect, test } from "bun:test"
import type { AutomationRun } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { filterRuns, formatDuration, outcomeOf, runDurationMs } from "../src/routine-run-log.ts"

const run = (id: string, extra: Partial<AutomationRun> = {}): AutomationRun =>
  ({
    id,
    automationId: "a",
    runNumber: 1,
    scheduledFor: "2026-11-06T00:00:00Z",
    status: "dispatched",
    trigger: "scheduled",
    at: "2026-11-06T00:00:00Z",
    ...extra,
  }) as AutomationRun

describe("the routine run log", () => {
  test("a run that is blocked on a person is its own outcome, apart from failed and healthy skips", () => {
    const outcomes = (
      [
        "dispatched",
        "skipped_blocked",
        "dispatch_failed",
        "skipped_unavailable",
        "script_failed",
        "skipped_precheck",
        "skipped_missed",
        "ran",
      ] as const
    ).map((status) => outcomeOf({ status }))
    expect(outcomes).toEqual(["ok", "blocked", "failed", "failed", "failed", "skipped", "skipped", "ok"])
  })

  test("duration is the precheck's own for a precheck skip, the time to the agent's report otherwise, else unknown", () => {
    expect(
      runDurationMs(
        run("p", {
          status: "skipped_precheck",
          precheckResult: { exitCode: 1, timedOut: false, stdout: "", stderr: "", durationMs: 1500 },
        }),
      ),
    ).toBe(1500)
    expect(runDurationMs(run("r", { response: { text: "done", at: "2026-11-06T00:04:00Z" } }))).toBe(240_000)
    expect(runDurationMs(run("n"))).toBeNull()
    expect(runDurationMs(run("s", { status: "ran", response: { text: "ok", at: "2026-11-06T00:00:00Z" } }))).toBeNull()
    expect([formatDuration(900), formatDuration(45_000), formatDuration(240_000), formatDuration(3_900_000)]).toEqual([
      "900ms",
      "45s",
      "4m",
      "1h 5m",
    ])
  })

  test("filters by outcome and lists newest first", () => {
    const runs = [
      run("a1", { at: "2026-11-06T00:01:00Z" }),
      run("a2", { status: "skipped_blocked", at: "2026-11-06T00:03:00Z" }),
      run("a3", { status: "dispatch_failed", at: "2026-11-06T00:02:00Z" }),
    ]
    expect(filterRuns(runs, null).map((r) => r.id)).toEqual(["a2", "a3", "a1"])
    expect(filterRuns(runs, "failed").map((r) => r.id)).toEqual(["a3"])
    expect(filterRuns(runs, "ok").map((r) => r.id)).toEqual(["a1"])
  })
})
