import { RGBA } from "@opentui/core"
import { describe, expect, it } from "vitest"
import { contrastRatio } from "../../src/tui/context/contrast-guard"
import { BUNDLED_THEMES, applyDisplayOverlay, resolveTheme, resolveThemeMode } from "../../src/tui/context/theme-core"
import { terminalDefaultColorsForTheme } from "../../src/tui/lib/terminal-colors"

type ThemeJson = (typeof BUNDLED_THEMES)[keyof typeof BUNDLED_THEMES]

const base = resolveTheme(BUNDLED_THEMES.claude as never, "dark")

describe("applyDisplayOverlay", () => {
  it("derives focusAccent from the chosen slot", () => {
    expect(applyDisplayOverlay(base, "success", false).focusAccent).toBe(base.success)
    expect(applyDisplayOverlay(base, "info", false).focusAccent).toBe(base.info)
    expect(applyDisplayOverlay(base, "primary", false).focusAccent).toBe(base.primary)
  })

  it("leaves every other slot untouched when transparent is off", () => {
    const out = applyDisplayOverlay(base, "primary", false)
    expect(out.background).toBe(base.background)
    expect(out.backgroundPanel).toBe(base.backgroundPanel)
    expect(out.backgroundElement).toBe(base.backgroundElement)
    expect(out.text).toBe(base.text)
  })

  it("transparent mode zeroes background AND backgroundPanel only", () => {
    const out = applyDisplayOverlay(base, "primary", true)
    expect(out.background.a).toBe(0)
    expect(out.backgroundPanel.a).toBe(0)
    expect(out.background.toInts().slice(0, 3)).toEqual(base.background.toInts().slice(0, 3))
    expect(out.backgroundPanel.toInts().slice(0, 3)).toEqual(base.backgroundPanel.toInts().slice(0, 3))
    // The composer body tint survives so input stays legible…
    expect(out.backgroundElement).toBe(base.backgroundElement)
    // …and the dialog card stays opaque so overlays stay readable.
    expect(out.backgroundDialog).toBe(base.backgroundDialog)
  })

  describe("with a detected host background (transparent mode)", () => {
    const lightHost = RGBA.fromHex("#FFFFFF")

    it("guards host-backed warning without changing warning on opaque surfaces", () => {
      const out = applyDisplayOverlay(base, "primary", true, lightHost)
      // These sit directly on the host terminal background.
      expect(contrastRatio(out.text, lightHost)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(out.textMuted, lightHost)).toBeGreaterThanOrEqual(4.5)
      expect(out.warningOnHost).toBeDefined()
      expect(contrastRatio(out.warningOnHost, lightHost)).toBeGreaterThanOrEqual(4.5)
      expect(out.warning).toBe(base.warning)
      expect(contrastRatio(out.warning, out.backgroundDialog)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(out.warning, out.backgroundElement)).toBeGreaterThanOrEqual(4.5)
      // …and the lift moves away from the light host, not toward it.
      expect(out.textMuted.toInts()[0]).toBeLessThan(base.textMuted.toInts()[0])
    })

    it("keeps the transparent-background policy untouched", () => {
      const out = applyDisplayOverlay(base, "primary", true, lightHost)
      expect(out.background.a).toBe(0)
      expect(out.backgroundPanel.a).toBe(0)
      expect(out.backgroundElement).toBe(base.backgroundElement)
      expect(out.backgroundDialog).toBe(base.backgroundDialog)
    })

    it("leaves dark-host tokens untouched (zero shift where the palette already works)", () => {
      const out = applyDisplayOverlay(base, "primary", true, RGBA.fromHex("#141413"))
      expect(out.text).toBe(base.text)
      expect(out.textMuted).toBe(base.textMuted)
      expect(out.warning).toBe(base.warning)
      expect(out.warningOnHost).toBe(base.warning)
    })

    it("ignores the host background when transparent mode is off", () => {
      const out = applyDisplayOverlay(base, "primary", false, lightHost)
      expect(out.text).toBe(base.text)
      expect(out.textMuted).toBe(base.textMuted)
      expect(out.warning).toBe(base.warning)
      expect(out.warningOnHost).toBe(base.warning)
      expect(out.background).toBe(base.background)
    })

    it("falls back to the status quo when no host background is known", () => {
      const out = applyDisplayOverlay(base, "primary", true)
      expect(out.text).toBe(base.text)
      expect(out.textMuted).toBe(base.textMuted)
      expect(out.warning).toBe(base.warning)
      expect(out.warningOnHost).toBe(base.warning)
    })

    it.each<[string, ThemeJson, "dark" | "light"]>(
      Object.entries(BUNDLED_THEMES).flatMap(([name, json]) =>
        (["dark", "light"] as const).map((mode): [string, ThemeJson, "dark" | "light"] => [name, json, mode]),
      ),
    )("guards %s %s body text against a light host", (_name, json, mode) => {
      const resolved = resolveTheme(json, mode)
      const out = applyDisplayOverlay(resolved, "primary", true, lightHost)
      expect(contrastRatio(out.text, lightHost)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(out.textMuted, lightHost)).toBeGreaterThanOrEqual(4.5)
    })

    it.each(Object.entries(BUNDLED_THEMES))(
      "keeps %s dark warning readable on host, dialog, and element backgrounds",
      (_name, json) => {
        const resolved = resolveTheme(json, "dark")
        const out = applyDisplayOverlay(resolved, "primary", true, lightHost)
        expect(contrastRatio(out.warningOnHost, lightHost)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(out.warning, out.backgroundDialog)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(out.warning, out.backgroundElement)).toBeGreaterThanOrEqual(4.5)
      },
    )
  })
})

describe("skylight", () => {
  it.each(["dark", "light"] as const)(
    "keeps body, muted and state text at 4.5:1 on its canvas, panels and selected row in %s mode",
    (mode) => {
      const theme = resolveTheme(BUNDLED_THEMES.skylight as never, mode)
      const inks = ["text", "textMuted", "primary", "info", "success", "warning", "error"] as const
      const surfaces = ["background", "backgroundPanel", "backgroundElement", "backgroundDialog"] as const
      const pairs = inks.flatMap((ink) => surfaces.map((surface) => ({ ink, surface })))
      expect(
        pairs
          .filter(({ ink, surface }) => contrastRatio(theme[ink], theme[surface]) < 4.5)
          .map(({ ink, surface }) => `${ink} on ${surface}`),
      ).toEqual([])
      // A selected list row paints selectedListItemText on the primary fill.
      expect(contrastRatio(theme.selectedListItemText, theme.primary)).toBeGreaterThanOrEqual(4.5)
    },
  )
})

describe("resolveThemeMode", () => {
  it("an explicit mode ignores the terminal; auto follows it, and draws dark before (or without) an answer", () => {
    expect(resolveThemeMode("light", "dark")).toBe("light")
    expect(resolveThemeMode("dark", "light")).toBe("dark")
    expect(resolveThemeMode("auto", "light")).toBe("light")
    expect(resolveThemeMode("auto", null)).toBe("dark")
  })
})

describe("terminalDefaultColorsForTheme", () => {
  it("reports the light half when the TUI draws light", () => {
    expect(terminalDefaultColorsForTheme(BUNDLED_THEMES.skylight as never, "light")).toEqual({
      foreground: "#16202c",
      background: "#fafbfc",
    })
  })

  it("reports the embedded terminal's actual foreground and background", () => {
    expect(terminalDefaultColorsForTheme(BUNDLED_THEMES.claude as never)).toEqual({
      foreground: "#eae7df",
      background: "#141413",
    })
  })
})
