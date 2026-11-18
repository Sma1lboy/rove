import { RGBA } from "@opentui/core"
import { describe, expect, it, vi } from "vitest"
import { contrastRatio } from "../../src/tui/context/contrast-guard"
import { BUNDLED_THEMES, resolveTheme } from "../../src/tui/context/theme-core"
import { SEMANTIC_GUARD_DEG, hueDistance, hueOf, taskColor } from "../../src/tui/lib/task-color"

const ids = Array.from({ length: 60 }, (_, i) => `01M3QD${String(i).padStart(4, "0")}ZEYTRQYCSWCBEZR8AY`)
const themes = Object.keys(BUNDLED_THEMES).flatMap((name) =>
  (["dark", "light"] as const).map((mode) => ({
    label: `${name}/${mode}`,
    theme: resolveTheme(BUNDLED_THEMES[name], mode),
  })),
)

describe("taskColor", () => {
  it("gives a task the same colour after a restart", async () => {
    const theme = resolveTheme(BUNDLED_THEMES.claude, "dark")
    const before = ids.map((id) => taskColor(id, theme).toInts())
    vi.resetModules()
    const fresh = await import("../../src/tui/lib/task-color")
    expect(ids.map((id) => fresh.taskColor(id, resolveTheme(BUNDLED_THEMES.claude, "dark")).toInts())).toEqual(before)
  })

  it.each(themes)("spreads different ids across many hues on $label", ({ theme }) => {
    const hues = ids.map((id) => Math.round(hueOf(taskColor(id, theme)) ?? -1))
    expect(new Set(hues).size).toBeGreaterThan(ids.length / 2)
  })

  it.each(themes)(
    "never lands near the $label success, warning or error hue, and stays legible on its background",
    ({ theme }) => {
      const semantic = [theme.success, theme.warning, theme.error].map(hueOf).filter((h) => h !== undefined)
      const colors = ids.map((id) => taskColor(id, theme))
      expect(colors.filter((color) => hueOf(color) === undefined)).toEqual([])
      const nearest = Math.min(...colors.flatMap((color) => semantic.map((s) => hueDistance(hueOf(color) ?? 0, s))))
      expect(nearest).toBeGreaterThanOrEqual(SEMANTIC_GUARD_DEG)
      expect(Math.min(...colors.map((color) => contrastRatio(color, theme.background)))).toBeGreaterThanOrEqual(3)
    },
  )

  it("passes a palette accent through unchanged", () => {
    const accent = RGBA.fromIndex(5)
    const theme = { ...resolveTheme(BUNDLED_THEMES.claude, "dark"), accent }
    expect(taskColor(ids[0] ?? "", theme)).toBe(accent)
  })
})
