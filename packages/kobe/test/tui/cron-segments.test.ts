import { describe, expect, test } from "vitest"
import {
  CRON_SEGMENTS,
  describeCron,
  joinCron,
  ladderFor,
  moveSegmentCursor,
  setSegment,
  splitCron,
  stepSegment,
} from "../../src/tui/component/cron-segments"

describe("splitCron / joinCron", () => {
  test("round-trips a normal expression", () => {
    expect(splitCron("0 9 * * MON-FRI")).toEqual(["0", "9", "*", "*", "MON-FRI"])
    expect(joinCron(["0", "9", "*", "*", "MON-FRI"])).toBe("0 9 * * MON-FRI")
  })

  test("pads a short expression with stars instead of losing segments", () => {
    // The editor always shows five cells; a half-typed value must not make one
    // disappear.
    expect(splitCron("0 9")).toEqual(["0", "9", "*", "*", "*"])
    expect(splitCron("")).toEqual(["*", "*", "*", "*", "*"])
  })

  test("collapses irregular whitespace", () => {
    expect(splitCron("  0   9  *  * MON ")).toEqual(["0", "9", "*", "*", "MON"])
  })
})

describe("moveSegmentCursor", () => {
  test("clamps at both ends — the row has edges, not a wrap", () => {
    expect(moveSegmentCursor(0, -1)).toBe(0)
    expect(moveSegmentCursor(0, 1)).toBe(1)
    expect(moveSegmentCursor(CRON_SEGMENTS.length - 1, 1)).toBe(CRON_SEGMENTS.length - 1)
  })
})

describe("stepSegment", () => {
  test("walks the ladder and wraps", () => {
    expect(stepSegment("minute", "*", 1)).toBe("*/5")
    expect(stepSegment("minute", "*/5", -1)).toBe("*")
    // Wrapping backwards off the first rung reaches the last.
    expect(stepSegment("minute", "*", -1)).toBe("59")
  })

  test("weekday ladder leads with the ranges people actually mean", () => {
    expect(stepSegment("dayOfWeek", "*", 1)).toBe("MON-FRI")
    expect(stepSegment("dayOfWeek", "MON-FRI", 1)).toBe("SAT,SUN")
  })

  test("month ladder uses names, not numbers", () => {
    expect(stepSegment("month", "*", 1)).toBe("JAN")
    expect(ladderFor("month")).toContain("DEC")
  })

  test("a hand-typed value off the ladder lands on an end rather than being rewritten", () => {
    // `17-23` is legal cron the ladder does not carry. Stepping should take
    // the user somewhere predictable, and typing it again must stay possible.
    expect(stepSegment("hour", "17-23", 1)).toBe("*")
    expect(stepSegment("hour", "17-23", -1)).toBe("23")
  })

  test("is case-insensitive about names", () => {
    expect(stepSegment("dayOfWeek", "mon-fri", 1)).toBe("SAT,SUN")
  })

  test("every ladder starts at `*` so clearing a segment is one step away", () => {
    for (const segment of CRON_SEGMENTS) {
      expect(ladderFor(segment)[0], segment).toBe("*")
    }
  })
})

describe("setSegment", () => {
  test("replaces one field and leaves the rest", () => {
    expect(setSegment("0 9 * * MON-FRI", 1, "18")).toBe("0 18 * * MON-FRI")
  })

  test("ignores an out-of-range index instead of corrupting the expression", () => {
    expect(setSegment("0 9 * * *", 9, "x")).toBe("0 9 * * *")
    expect(setSegment("0 9 * * *", -1, "x")).toBe("0 9 * * *")
  })
})

describe("describeCron", () => {
  test("names the shapes people schedule", () => {
    expect(describeCron("0 9 * * MON-FRI")).toBe("weekdays at 09:00")
    expect(describeCron("0 9 * * SAT,SUN")).toBe("weekends at 09:00")
    expect(describeCron("30 6 * * *")).toBe("every day at 06:30")
  })

  test("pluralizes ALL seven days — not just the ones where code+`days` happens to read", () => {
    // MON/FRI/SUN read fine with naive `${code}days`; TUE/WED/THU/SAT don't
    // ("Tuedays"). Sampling one lucky day is how the bug shipped green.
    const days: Array<[string, string]> = [
      ["MON", "Mondays"],
      ["TUE", "Tuesdays"],
      ["WED", "Wednesdays"],
      ["THU", "Thursdays"],
      ["FRI", "Fridays"],
      ["SAT", "Saturdays"],
      ["SUN", "Sundays"],
    ]
    for (const [code, name] of days) {
      expect(describeCron(`0 9 * * ${code}`), code).toBe(`${name} at 09:00`)
    }
  })

  test("adds 'every day' only to a specific time — an every-N phrase already recurs", () => {
    // "every day every 15m" double-qualifies; the interval phrase stands alone.
    expect(describeCron("*/15 * * * *")).toBe("every 15m")
    expect(describeCron("0 */6 * * *")).toBe("every 6h")
    expect(describeCron("* * * * *")).toBe("every minute")
    expect(describeCron("30 * * * *")).toBe("every day hourly at :30")
  })

  test("spells every weekday the ladder can reach", () => {
    // Mechanical `TUE` + "days" spelled four of the seven wrong
    // ("Tuedays", "Weddays", "Thudays", "Satdays").
    expect(describeCron("0 9 * * TUE")).toBe("Tuesdays at 09:00")
    expect(describeCron("0 9 * * WED")).toBe("Wednesdays at 09:00")
    expect(describeCron("0 9 * * THU")).toBe("Thursdays at 09:00")
    expect(describeCron("0 9 * * FRI")).toBe("Fridays at 09:00")
    expect(describeCron("0 9 * * SAT")).toBe("Saturdays at 09:00")
    expect(describeCron("0 9 * * SUN")).toBe("Sundays at 09:00")
  })

  test("stays silent on an hourly list/range minute instead of naming a false time", () => {
    // `15,45` is two fire times, not one — "hourly at :15,45" asserts a
    // clock time the schedule never has.
    expect(describeCron("15,45 * * * *")).toBeNull()
    expect(describeCron("10-20 * * * *")).toBeNull()
    // A plain hourly minute still names itself.
    expect(describeCron("15 * * * *")).toBe("every day hourly at :15")
  })

  test("stays silent rather than describing a shape it does not model", () => {
    // A half-truth about when a schedule fires is worse than the raw cron —
    // the next-run preview already carries the ground truth.
    expect(describeCron("0 9 1 * *")).toBeNull()
    expect(describeCron("0 9 * JAN *")).toBeNull()
    expect(describeCron("0 9-17 * * *")).toBeNull()
  })
})
