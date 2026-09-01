import { describe, expect, it } from "vitest"
import { displayWidth } from "../../src/lib/display-width.ts"
import {
  type FooterChipsView,
  USAGE_BAR_WIDTH,
  buildFooterChips,
  formatReset,
  narrowUsageChip,
  usageChipsBudget,
  usageRows,
} from "../../src/tui-react/component/settings-dialog/usage-core.ts"
import { ratioBar } from "../../src/tui/lib/progress-bar.ts"

const NOW = Date.parse("2026-07-27T12:00:00.000Z")

describe("ratioBar", () => {
  it("renders empty, partial, and full meters at exactly the given width", () => {
    expect(ratioBar(0, 10)).toBe("░".repeat(10))
    expect(ratioBar(1, 10)).toBe("█".repeat(10))
    expect(ratioBar(0.5, 10)).toBe("█████░░░░░")
    for (const r of [0, 0.13, 0.5, 0.87, 1]) expect(ratioBar(r, 10)).toHaveLength(10)
  })

  it("clamps out-of-range ratios", () => {
    expect(ratioBar(-1, 8)).toBe("░".repeat(8))
    expect(ratioBar(2, 8)).toBe("█".repeat(8))
  })

  it("uses an eighth block for fractional cells", () => {
    expect(ratioBar(0.05, 10)).toBe(`▌${"░".repeat(9)}`)
  })
})

describe("formatReset", () => {
  it("shows clock only within 24h, day+clock beyond, empty when absent/past", () => {
    const in2h = NOW + 2 * 60 * 60 * 1000
    const in3d = NOW + 3 * 24 * 60 * 60 * 1000
    const clock = (ms: number) => {
      const d = new Date(ms)
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    }
    expect(formatReset(in2h, NOW)).toBe(`→ ${clock(in2h)}`)
    const d3 = new Date(in3d)
    expect(formatReset(in3d, NOW)).toBe(`→ ${d3.getMonth() + 1}/${d3.getDate()} ${clock(in3d)}`)
    expect(formatReset(null, NOW)).toBe("")
    expect(formatReset(NOW - 1000, NOW)).toBe("")
  })
})

describe("usageRows", () => {
  it("aligns labels, renders meters, and grades tones by utilization", () => {
    const rows = usageRows(
      {
        windows: [
          { kind: "session", label: "5h", percent: 43, resetsAt: NOW + 1000 * 60 },
          { kind: "weekly_all", label: "7d", percent: 80, resetsAt: null },
          { kind: "weekly_scoped", label: "Fable", percent: 100, resetsAt: NOW + 1000 * 60 },
        ],
        capturedAt: NOW,
      },
      NOW,
    )
    expect(rows.map((r) => r.label)).toEqual(["5h   ", "7d   ", "Fable"])
    expect(rows.map((r) => r.tone)).toEqual(["ok", "warn", "crit"])
    expect(rows.map((r) => r.percentText)).toEqual([" 43%", " 80%", "100%"])
    expect(rows[0]?.bar).toBe(ratioBar(0.43, USAGE_BAR_WIDTH))
    expect(rows[1]?.resetText).toBe("")
  })

  it("caps the label column so a long scoped model name cannot blow the layout", () => {
    const rows = usageRows(
      {
        windows: [{ kind: "weekly_scoped", label: "Extremely Long Model Name", percent: 10, resetsAt: null }],
        capturedAt: NOW,
      },
      NOW,
    )
    expect(rows[0]?.label).toBe("Extremel")
  })
})

describe("narrowUsageChip", () => {
  it("pins the session window regardless of its order", () => {
    const chip = narrowUsageChip(
      {
        windows: [
          { kind: "weekly_all", label: "7d", percent: 80, resetsAt: null },
          { kind: "session", label: "5h", percent: 43, resetsAt: NOW + 1000 * 60 },
        ],
        capturedAt: NOW,
      },
      NOW,
    )
    expect(chip).toMatchObject({ label: "5h", percentText: "43%", tone: "ok" })
  })

  it("falls back to the first window when no session window exists", () => {
    const chip = narrowUsageChip(
      { windows: [{ kind: "primary", label: "7d", percent: 96, resetsAt: null }], capturedAt: NOW },
      NOW,
    )
    expect(chip).toMatchObject({ label: "7d", percentText: "96%", tone: "crit" })
  })

  it("returns null for a vendor with no windows", () => {
    expect(narrowUsageChip({ windows: [], capturedAt: NOW }, NOW)).toBeNull()
  })
})

/**
 * Footer-row layout contract: the chips and the key-hint bar share ONE
 * 1-cell row, so the chip view must never exceed its budget — on an 80-col
 * terminal the full label/reset form (≈45 cells for two vendors) does not
 * fit beside the hint bar and must degrade, not collide.
 */
describe("footer chips layout", () => {
  const usageOf = (percent: number) => ({
    windows: [
      { kind: "session" as const, label: "5h", percent, resetsAt: null },
      { kind: "weekly_all" as const, label: "7d", percent: 80, resetsAt: null },
    ],
    capturedAt: NOW,
  })
  const twoVendors = new Map([
    ["claude", usageOf(42)],
    ["codex", usageOf(47)],
  ])
  const build = (budget: number, usage: ReadonlyMap<string, ReturnType<typeof usageOf>> = twoVendors) =>
    buildFooterChips({ usage, budget, nowMs: NOW, vendorLabel: (v) => v })

  /** Cell width of the rendered row, mirroring the component's gaps. */
  const viewCells = (view: FooterChipsView): number => {
    const perVendor =
      view.form === "full"
        ? view.vendors.map(
            (v) =>
              displayWidth(v.vendor) +
              v.chips.reduce(
                (sum, chip, i) =>
                  sum +
                  displayWidth(i === 0 ? chip.label : `· ${chip.label}`) +
                  displayWidth(chip.percentText) +
                  (chip.resetText ? 1 + displayWidth(chip.resetText) : 0) +
                  1,
                0,
              ),
          )
        : view.vendors.map((v) => displayWidth(v.vendor) + 1 + displayWidth(v.percentText))
    return perVendor.reduce((a, b) => a + b, 0) + Math.max(0, perVendor.length - 1) * 2
  }

  it("usageChipsBudget subtracts padding, gap, and the measured hint bar", () => {
    expect(usageChipsBudget({ terminalWidth: 80, hintCells: 36 })).toBe(40)
    expect(usageChipsBudget({ terminalWidth: 200, hintCells: 36 })).toBe(160)
    expect(usageChipsBudget({ terminalWidth: 20, hintCells: 36 })).toBe(0)
  })

  it("keeps the full label/reset form when it fits (wide terminal)", () => {
    const view = build(160)
    expect(view?.form).toBe("full")
    expect(view && viewCells(view)).toBeLessThanOrEqual(160)
    expect(view?.form === "full" ? view.vendors.flatMap((v) => v.chips.map((c) => c.label)) : []).toContain("7d")
  })

  it("degrades to compact vendor+percent chips at an 80-col budget", () => {
    const view = build(40)
    expect(view?.form).toBe("compact")
    expect(view?.form === "compact" ? view.vendors.map((v) => v.vendor) : []).toEqual(["CLAUDE", "CODEX"])
    expect(view?.form === "compact" ? view.vendors.map((v) => v.percentText) : []).toEqual(["42%", "47%"])
    expect(view && viewCells(view)).toBeLessThanOrEqual(40)
  })

  it("truncates the overflowing vendor's name and drops vendors past it", () => {
    const view = build(12)
    expect(view?.form).toBe("compact")
    // CLAUDE 42% (10 cells) fits; CODEX would not — it is dropped, not overlapped.
    expect(view?.form === "compact" ? view.vendors.map((v) => v.vendor) : []).toEqual(["CLAUDE"])
    expect(view && viewCells(view)).toBeLessThanOrEqual(12)

    const truncated = build(8)
    expect(truncated?.form === "compact" ? truncated.vendors[0] : undefined).toMatchObject({
      vendor: "CLA…",
      percentText: "42%",
    })
    expect(truncated && viewCells(truncated)).toBeLessThanOrEqual(8)
  })

  it("forceCompact skips the full form even with a wide budget", () => {
    const view = buildFooterChips({
      usage: twoVendors,
      budget: 160,
      nowMs: NOW,
      vendorLabel: (v) => v,
      forceCompact: true,
    })
    expect(view?.form).toBe("compact")
  })

  it("filters vendors with no windows and returns null for empty usage", () => {
    const withEmpty = new Map([
      ["empty", { windows: [], capturedAt: NOW }],
      ["claude", usageOf(42)],
    ])
    const view = build(160, withEmpty)
    expect(view?.form === "full" ? view.vendors.map((v) => v.vendor) : []).toEqual(["CLAUDE"])
    expect(build(160, new Map())).toBeNull()
  })
})
