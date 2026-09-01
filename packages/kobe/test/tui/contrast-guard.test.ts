import { RGBA } from "@opentui/core"
import { describe, expect, it } from "vitest"
import {
  HOST_TEXT_MIN_CONTRAST,
  contrastRatio,
  contrastRatioTriplet,
  ensureContrast,
  relativeLuminance,
} from "../../src/tui/context/contrast-guard"

const rgb = (hex: string): RGBA => RGBA.fromHex(hex)

describe("relativeLuminance", () => {
  it("maps black to 0 and white to 1", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(relativeLuminance([255, 255, 255])).toBe(1)
  })

  it("orders mid tones between the poles", () => {
    const gray = relativeLuminance([128, 128, 128])
    expect(gray).toBeGreaterThan(0)
    expect(gray).toBeLessThan(1)
  })
})

describe("contrastRatio", () => {
  it("black on white is 21:1", () => {
    expect(contrastRatioTriplet([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
  })

  it("claude textMuted on a white host is below the readable floor (the reported defect)", () => {
    // #A9A39A carries sidebar subtitles, footer chips, hint bars, and empty
    // states; on a light host terminal it lands near 2.5:1.
    const ratio = contrastRatio(rgb("#A9A39A"), rgb("#FFFFFF"))
    expect(ratio).toBeLessThan(HOST_TEXT_MIN_CONTRAST)
    expect(ratio).toBeCloseTo(2.5, 0)
  })

  it("claude primary text on a white host is also below the floor", () => {
    expect(contrastRatio(rgb("#EAE7DF"), rgb("#FFFFFF"))).toBeLessThan(HOST_TEXT_MIN_CONTRAST)
  })

  it("claude textMuted on its own dark background clears the floor untouched", () => {
    expect(contrastRatio(rgb("#A9A39A"), rgb("#141413"))).toBeGreaterThanOrEqual(HOST_TEXT_MIN_CONTRAST)
  })
})

describe("ensureContrast", () => {
  it("returns the same color when it already clears the floor", () => {
    const fg = rgb("#A9A39A")
    const bg = rgb("#141413")
    expect(ensureContrast(fg, bg)).toBe(fg)
  })

  it("darkens muted ink against a light host until it clears the floor", () => {
    const out = ensureContrast(rgb("#A9A39A"), rgb("#FFFFFF"))
    expect(contrastRatio(out, rgb("#FFFFFF"))).toBeGreaterThanOrEqual(HOST_TEXT_MIN_CONTRAST)
    expect(relativeLuminance([out.toInts()[0], out.toInts()[1], out.toInts()[2]])).toBeLessThan(
      relativeLuminance([0xa9, 0xa3, 0x9a]),
    )
  })

  it("lightens ink against a dark host when needed", () => {
    const out = ensureContrast(rgb("#3A3A3A"), rgb("#141413"))
    expect(contrastRatio(out, rgb("#141413"))).toBeGreaterThanOrEqual(HOST_TEXT_MIN_CONTRAST)
    expect(relativeLuminance([out.toInts()[0], out.toInts()[1], out.toInts()[2]])).toBeGreaterThan(
      relativeLuminance([0x3a, 0x3a, 0x3a]),
    )
  })

  it("can always escape an identical background (white on white)", () => {
    const out = ensureContrast(rgb("#FFFFFF"), rgb("#FFFFFF"))
    expect(contrastRatio(out, rgb("#FFFFFF"))).toBeGreaterThanOrEqual(HOST_TEXT_MIN_CONTRAST)
  })

  it("mid-tone host lightens rather than darkens, keeping opaque dark surfaces readable", () => {
    // A mid-gray wallpaper: darkening would hit the host floor but sink the
    // token to ~1:1 on the still-opaque dark dialog/element surfaces.
    const out = ensureContrast(rgb("#A9A39A"), rgb("#808080"))
    const outLum = relativeLuminance([out.toInts()[0], out.toInts()[1], out.toInts()[2]])
    expect(outLum).toBeGreaterThan(relativeLuminance([0xa9, 0xa3, 0x9a]))
    // …and the result stays legible on the opaque dark theme surfaces.
    expect(contrastRatio(out, rgb("#141413"))).toBeGreaterThanOrEqual(3)
  })

  it("preserves hue — channel ordering survives the lightness move", () => {
    // A warm gray keeps its r ≥ g ≥ b ordering rather than collapsing to a
    // pure neutral (or inverting).
    const gray = ensureContrast(rgb("#A9A39A"), rgb("#FFFFFF")).toInts()
    expect(gray[0]).toBeGreaterThanOrEqual(gray[1])
    expect(gray[1]).toBeGreaterThanOrEqual(gray[2])

    const blue = ensureContrast(rgb("#828bb8"), rgb("#F5F2EA")).toInts()
    // blue stays the dominant channel
    expect(blue[2]).toBeGreaterThan(blue[0])
    expect(blue[2]).toBeGreaterThan(blue[1])
  })

  it("preserves alpha", () => {
    const fg = RGBA.fromInts(169, 163, 154, 128)
    expect(ensureContrast(fg, rgb("#FFFFFF")).toInts()[3]).toBe(128)
  })
})
