import { describe, expect, test } from "bun:test"
import { parseStartAt } from "../src/schedule-start.ts"

// Built from local fields, so the results don't depend on the machine's time zone.
const NOW = new Date(2026, 10, 6, 21, 0, 0)
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime()

describe("parseStartAt", () => {
  test("a bare clock time is its next occurrence: later today, else tomorrow", () => {
    expect(parseStartAt("22:30", NOW)?.getTime()).toBe(at(6, 22, 30))
    expect(parseStartAt("9:00", NOW)?.getTime()).toBe(at(7, 9))
    expect(parseStartAt("9pm", NOW)?.getTime()).toBe(at(7, 21))
  })

  test("today and tomorrow are taken literally, so a time already gone today is refused", () => {
    expect(parseStartAt("tomorrow 9:00", NOW)?.getTime()).toBe(at(7, 9))
    expect(parseStartAt("明天 9:30", NOW)?.getTime()).toBe(at(7, 9, 30))
    expect(parseStartAt("today 8:00", NOW)).toBeNull()
    expect(parseStartAt("today 23:15", NOW)?.getTime()).toBe(at(6, 23, 15))
  })

  test("+30m, +2h and +1h30m count from now", () => {
    expect(parseStartAt("+30m", NOW)?.getTime()).toBe(NOW.getTime() + 30 * 60_000)
    expect(parseStartAt("+2h", NOW)?.getTime()).toBe(NOW.getTime() + 2 * 3_600_000)
    expect(parseStartAt("+1h30m", NOW)?.getTime()).toBe(NOW.getTime() + 90 * 60_000)
  })

  test("anything that is not a time ahead is refused", () => {
    for (const text of ["", "soon", "+", "+0m", "25:00", "9:75", "13pm", "tomorrow", "10 minutes"]) {
      expect(parseStartAt(text, NOW)).toBeNull()
    }
  })
})
