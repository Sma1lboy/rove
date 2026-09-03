/**
 * DST behaviour and scan cost. Separate from `cron.test.ts` because these pin
 * `TZ` for the whole process — a cron expression names a wall clock, so a
 * DST test that inherits the machine's timezone tests nothing on most boxes.
 *
 * `TZ` is set before the module under test is imported so the first `Date`
 * construction already sees it.
 */

process.env.TZ = "America/New_York"

import { describe, expect, it } from "vitest"
import { latestCronAtOrBefore, nextCronAfter } from "../../../kobe-daemon/src/daemon/cron.ts"

function day(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fireTimes(expression: string, fromIso: string, count: number): string[] {
  let t = new Date(fromIso).getTime()
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    t = nextCronAfter(expression, t)
    out.push(day(t))
  }
  return out
}

describe("DST fall-back", () => {
  // 2025-11-02 01:00 America/New_York happens twice — once at UTC-4, once at
  // UTC-5. Scanning epoch minutes and testing the local clock matched both, so
  // a daily routine ran twice: two worktrees, two branches, two billed turns.
  it("fires a daily routine once on the day the clock repeats an hour", () => {
    expect(fireTimes("0 1 * * *", "2025-11-01T12:00:00Z", 3)).toEqual([
      "2025-11-02 01:00",
      "2025-11-03 01:00",
      "2025-11-04 01:00",
    ])
  })

  it("holds for an hour that repeats only under a different rule (02:00, EU-style time)", () => {
    expect(fireTimes("0 1 * * *", "2025-11-02T05:30:00Z", 2)).toEqual(["2025-11-03 01:00", "2025-11-04 01:00"])
  })
})

describe("DST spring-forward", () => {
  // 2025-03-09 02:30 America/New_York does not exist. The old scan found no
  // matching instant that day and the routine vanished — no run, and no
  // `skipped_missed` either, because the backwards search missed it too.
  it("still fires on the day the local time is skipped", () => {
    expect(fireTimes("30 2 * * *", "2025-03-08T12:00:00Z", 3)).toEqual([
      "2025-03-09 03:30",
      "2025-03-10 02:30",
      "2025-03-11 02:30",
    ])
  })

  it("missed-run compensation sees that day too", () => {
    const found = latestCronAtOrBefore(
      "30 2 * * *",
      new Date(2025, 2, 9, 18, 0).getTime(),
      new Date(2025, 2, 1).getTime(),
    )
    expect(found === null ? null : day(found)).toBe("2025-03-09 03:30")
  })
})

describe("scan cost", () => {
  // `0 0 30 2 *` parses and never matches, so it walks the whole scan bound.
  // At a minute per step that was ~4.7M Date allocations (150ms+ measured),
  // run synchronously on the daemon's event loop AND in the TUI composer's
  // render body — one freeze per arrow keypress.
  it("a valid-but-never-matching expression fails fast", () => {
    const started = Date.now()
    expect(() => nextCronAfter("0 0 30 2 *", Date.now())).toThrow(/never matches/)
    expect(Date.now() - started).toBeLessThan(50)
  })
})
