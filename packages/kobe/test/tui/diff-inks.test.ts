/**
 * Colorblind diff inks: off leaves the theme's pair alone; on turns only the
 * added ink away from green, and palette-indexed inks pass through untouched.
 */

import { RGBA } from "@opentui/core"
import { describe, expect, it } from "vitest"
import { BUNDLED_THEMES, type Theme, diffInks, resolveTheme } from "../../src/tui/context/theme-core"

const theme = resolveTheme(BUNDLED_THEMES.claude ?? { theme: {} }, "dark")

/** Hue in degrees from RGB (HSV), enough to tell green from blue. */
function hue(color: RGBA): number {
  const [r, g, b] = color.toInts().map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

describe("diffInks", () => {
  it("off: the theme's own added/removed inks", () => {
    const inks = diffInks(theme, false)
    expect(inks.added).toBe(theme.diffAdded)
    expect(inks.removed).toBe(theme.diffRemoved)
    expect(inks.addedBg).toBe(theme.diffAddedBg)
  })

  it("on: added turns from green toward blue, removed stays", () => {
    const inks = diffInks(theme, true)
    expect(hue(theme.diffAdded)).toBeLessThan(150)
    expect(hue(inks.added)).toBeGreaterThan(170)
    expect(inks.removed).toBe(theme.diffRemoved)
  })

  it("on: a palette-indexed added ink passes through", () => {
    const indexed = RGBA.fromIndex(2)
    const inks = diffInks({ ...theme, diffAdded: indexed } as Theme, true)
    expect(inks.added).toBe(indexed)
  })
})
