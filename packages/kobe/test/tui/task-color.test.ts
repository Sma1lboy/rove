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

  it("spreads different ids across many hues", () => {
    for (const { theme } of themes) {
      const hues = ids.map((id) => Math.round(hueOf(taskColor(id, theme)) ?? -1))
      expect(new Set(hues).size).toBeGreaterThan(ids.length / 2)
    }
  })

  it("never lands near the theme's success, warning or error hue, and stays legible on its background", () => {
    for (const { label, theme } of themes) {
      const semantic = [theme.success, theme.warning, theme.error].map(hueOf).filter((h) => h !== undefined)
      for (const id of ids) {
        const color = taskColor(id, theme)
        const hue = hueOf(color)
        expect(hue, label).toBeDefined()
        for (const s of semantic)
          expect(hueDistance(hue ?? 0, s), `${label} ${id}`).toBeGreaterThanOrEqual(SEMANTIC_GUARD_DEG)
        expect(contrastRatio(color, theme.background), `${label} ${id}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it("passes a palette accent through unchanged", () => {
    const accent = RGBA.fromIndex(5)
    const theme = { ...resolveTheme(BUNDLED_THEMES.claude, "dark"), accent }
    expect(taskColor(ids[0] ?? "", theme)).toBe(accent)
  })
})
