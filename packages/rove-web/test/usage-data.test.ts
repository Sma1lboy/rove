import { describe, expect, test } from "bun:test"
import { bar, byEngineModel, dayKey, lastDays, runway, stackedBar, topTasks } from "../src/usage-data.ts"

const HOUR = 3_600_000
const NOW = new Date(2026, 10, 6, 15, 0, 0).getTime()
const turn = (id: string, hoursAgo: number, tokens: number, extra: Record<string, unknown> = {}) => ({
  taskId: id,
  vendor: "claude",
  model: "opus",
  startedAt: NOW - hoursAgo * HOUR,
  endedAt: NOW - hoursAgo * HOUR + 60_000,
  usage: { input_tokens: tokens, output_tokens: 0 },
  ...extra,
})

describe("the usage window", () => {
  test("turns land on their local day, per engine, and quiet days stay in the window", () => {
    const window = lastDays([turn("a", 1, 100), turn("b", 2, 50, { vendor: "codex" }), turn("c", 26, 10)], NOW, 14, 500)
    expect(window.days).toHaveLength(14)
    const today = window.days.at(-1)
    expect(today).toMatchObject({ day: dayKey(NOW), turns: 2, tokens: 150, byEngine: { claude: 100, codex: 50 } })
    expect(window.days.at(-2)).toMatchObject({ turns: 1, tokens: 10 })
    expect(window.days[0]).toMatchObject({ turns: 0, tokens: 0 })
    expect(window.cutoff).toBeNull()
  })

  test("a full page marks the oldest day and anything before it as partial", () => {
    const turns = [turn("a", 1, 1), turn("b", 50, 1), turn("c", 74, 1)]
    const window = lastDays(turns, NOW, 14, 3)
    expect(window.cutoff?.day).toBe(dayKey(NOW - 74 * HOUR))
    const partial = window.days.filter((day) => day.partial).map((day) => day.day)
    expect(partial.at(-1)).toBe(dayKey(NOW - 74 * HOUR))
    expect(window.days.at(-1)?.partial).toBe(false)
  })

  test("engine/model rows and top tasks rank by tokens; an engine that reports no tokens counts turns only", () => {
    const turns = [
      turn("a", 1, 5),
      turn("b", 2, 90),
      turn("b", 3, 10, { model: "sonnet" }),
      turn("c", 4, 0, { usage: undefined }),
    ]
    expect(byEngineModel(turns).map((row) => [row.model, row.tokens, row.turns])).toEqual([
      ["opus", 95, 3],
      ["sonnet", 10, 1],
    ])
    expect(topTasks(turns, 2).map((row) => [row.taskId, row.tokens])).toEqual([
      ["b", 100],
      ["a", 5],
    ])
  })
})

describe("text bars", () => {
  test("a bar is eighth-block steps, never empty for a non-zero value", () => {
    expect(bar(10, 10, 4)).toBe("████")
    expect(bar(5, 10, 4)).toBe("██")
    expect(bar(1, 1000, 4)).toBe("▏")
    expect(bar(0, 10, 4)).toBe("")
  })

  test("a stacked bar gives each engine its own shade and at least one cell", () => {
    expect(stackedBar({ claude: 80, codex: 1 }, ["claude", "codex"], 100, 10)).toBe("████████▓")
    expect(stackedBar({}, ["claude"], 100, 10)).toBe("")
  })
})

describe("quota runway", () => {
  const window = (percent: number, resetsInHours: number, label = "5h") => ({
    kind: "session",
    label,
    percent,
    resetsAt: NOW + resetsInHours * HOUR,
  })

  test("fills before the reset at the pace so far, else lasts", () => {
    // 3h into a 5h window at 60%: 40% left at 20%/h → full in 2h, which is the reset itself: lasts.
    expect(runway(window(60, 2), NOW)).toEqual({ kind: "lasts" })
    // 2h in at 80%: 20% left at 40%/h → full in 0.5h, before the reset.
    expect(runway(window(80, 3), NOW)).toEqual({ kind: "full", at: NOW + 0.5 * HOUR })
  })

  test("says nothing without a length, a reset time or any use", () => {
    expect(runway(window(0, 2), NOW)).toBeNull()
    expect(runway(window(50, 2, "opus"), NOW)).toBeNull()
    expect(runway({ kind: "session", label: "5h", percent: 50, resetsAt: null }, NOW)).toBeNull()
  })
})
