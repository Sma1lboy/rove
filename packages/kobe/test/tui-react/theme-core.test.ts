import { RGBA } from "@opentui/core"
import { describe, expect, it } from "vitest"
import { contrastRatio } from "../../src/tui/context/contrast-guard"
import { BUNDLED_THEMES, applyDisplayOverlay, resolveTheme } from "../../src/tui/context/theme-core"
import { terminalDefaultColorsForTheme } from "../../src/tui/lib/terminal-colors"

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

  it("resolveTheme output feeds the overlay for every bundled theme without throwing", () => {
    for (const [name, json] of Object.entries(BUNDLED_THEMES)) {
      const resolved = resolveTheme(json, "dark")
      const overlaid = applyDisplayOverlay(resolved, "info", true)
      expect(overlaid.focusAccent, name).toBeDefined()
    }
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

    it("guards every bundled theme's body text against a light host", () => {
      for (const mode of ["dark", "light"] as const) {
        for (const [name, json] of Object.entries(BUNDLED_THEMES)) {
          const resolved = resolveTheme(json, mode)
          const out = applyDisplayOverlay(resolved, "primary", true, lightHost)
          expect(contrastRatio(out.text, lightHost), `${name} ${mode} text`).toBeGreaterThanOrEqual(4.5)
          expect(contrastRatio(out.textMuted, lightHost), `${name} ${mode} textMuted`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it("keeps every dark theme warning readable on host, dialog, and element backgrounds", () => {
      for (const [name, json] of Object.entries(BUNDLED_THEMES)) {
        const resolved = resolveTheme(json, "dark")
        const out = applyDisplayOverlay(resolved, "primary", true, lightHost)
        expect(contrastRatio(out.warningOnHost, lightHost), `${name} host`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(out.warning, out.backgroundDialog), `${name} dialog`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(out.warning, out.backgroundElement), `${name} element`).toBeGreaterThanOrEqual(4.5)
      }
    })
  })
})

describe("terminalDefaultColorsForTheme", () => {
  it("reports the embedded terminal's actual foreground and background", () => {
    expect(terminalDefaultColorsForTheme(BUNDLED_THEMES.claude as never)).toEqual({
      foreground: "#eae7df",
      background: "#141413",
    })
  })
})
