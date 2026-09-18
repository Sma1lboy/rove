/**
 * `rgb()` / `rgba()` theme literals, checked at all THREE places a theme
 * colour is read — the parser, the opentui resolver the TUI renders from,
 * and the hex resolver CLI/external styling uses. A literal that parses in
 * one and not the others is the drift this file exists to catch.
 */
import { describe, expect, test } from "vitest"
import type { ThemeJson } from "../../src/tui/context/theme-core"
import { resolveTheme } from "../../src/tui/context/theme-core"
import { isRgbLiteral, parseRgbLiteral } from "../../src/tui/context/theme/color-literal"
import { resolveThemeSlotHex } from "../../src/tui/context/theme/hex"
import { validateTheme } from "../../src/tui/context/theme/schema"

const themeOf = (value: string): ThemeJson => ({ theme: { accent: value } }) as unknown as ThemeJson

describe("parseRgbLiteral", () => {
  test("parses rgb() with opaque alpha", () => {
    expect(parseRgbLiteral("rgb(134, 225, 252)")).toEqual({ r: 134, g: 225, b: 252, a: 255 })
  })

  test("parses rgba() and converts CSS 0-1 alpha to a byte", () => {
    expect(parseRgbLiteral("rgba(134, 225, 252, 0.5)")).toEqual({ r: 134, g: 225, b: 252, a: 128 })
    expect(parseRgbLiteral("rgba(0, 0, 0, 0)")?.a).toBe(0)
    expect(parseRgbLiteral("rgba(0, 0, 0, 1)")?.a).toBe(255)
  })

  test("whitespace around components is free", () => {
    expect(parseRgbLiteral("  rgba(1,2,3,.25)  ")).toEqual({ r: 1, g: 2, b: 3, a: 64 })
  })

  test("rejects out-of-range components instead of clamping like CSS", () => {
    expect(parseRgbLiteral("rgb(300, 0, 0)")).toBeNull()
    expect(parseRgbLiteral("rgba(0, 0, 0, 2)")).toBeNull()
  })

  test("rejects the space-separated CSS form and other near-misses", () => {
    expect(parseRgbLiteral("rgb(134 225 252)")).toBeNull()
    expect(parseRgbLiteral("rgb(1, 2)")).toBeNull()
    expect(parseRgbLiteral("rgb(1, 2, 3, 4, 5)")).toBeNull()
    expect(parseRgbLiteral("#86e1fc")).toBeNull()
  })

  test("isRgbLiteral spots the SHAPE, so a typo is a bad literal not a def name", () => {
    expect(isRgbLiteral("rgb(300, 0, 0)")).toBe(true)
    expect(parseRgbLiteral("rgb(300, 0, 0)")).toBeNull()
    expect(isRgbLiteral("darkCyan")).toBe(false)
  })
})

describe("resolveTheme — the path the TUI renders from", () => {
  test("resolves an rgb() literal, alpha included", () => {
    expect(resolveTheme(themeOf("rgba(134, 225, 252, 0.5)")).accent.toInts()).toEqual([134, 225, 252, 128])
  })

  test("resolves an rgb() literal reached through a defs ref", () => {
    const theme = { defs: { brand: "rgb(1, 2, 3)" }, theme: { accent: "brand" } } as unknown as ThemeJson
    expect(resolveTheme(theme).accent.toInts()).toEqual([1, 2, 3, 255])
  })

  test("a malformed literal still collapses to black rather than throwing", () => {
    expect(resolveTheme(themeOf("rgb(300, 0, 0)")).accent.toInts()).toEqual([0, 0, 0, 255])
  })
})

describe("resolveThemeSlotHex — the opentui-free path", () => {
  test("formats an rgb() literal as #rrggbb", () => {
    expect(resolveThemeSlotHex(themeOf("rgb(134, 225, 252)"), "accent")).toBe("#86e1fc")
  })

  test("drops alpha, exactly as it does for #rrggbbaa", () => {
    expect(resolveThemeSlotHex(themeOf("rgba(134, 225, 252, 0.5)"), "accent")).toBe("#86e1fc")
  })

  test("pads single-digit channels", () => {
    expect(resolveThemeSlotHex(themeOf("rgb(1, 2, 3)"), "accent")).toBe("#010203")
  })
})

describe("validateTheme — a typo is named, not silently black", () => {
  test("accepts a well-formed literal in a slot, a variant, and defs", () => {
    expect(validateTheme({ theme: { accent: "rgb(1, 2, 3)" } }).ok).toBe(true)
    expect(validateTheme({ theme: { accent: { dark: "rgba(1,2,3,.5)", light: "#fff" } } }).ok).toBe(true)
    expect(validateTheme({ defs: { brand: "rgb(1, 2, 3)" }, theme: {} }).ok).toBe(true)
  })

  test("rejects a malformed literal and names the value", () => {
    for (const value of [
      { theme: { accent: "rgb(300, 0, 0)" } },
      { theme: { accent: { dark: "rgb(300, 0, 0)", light: "#fff" } } },
      { defs: { brand: "rgb(300, 0, 0)" }, theme: {} },
    ]) {
      const result = validateTheme(value)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain("rgb(300, 0, 0)")
    }
  })

  test("a plain def name is still a ref, not a rejected literal", () => {
    expect(validateTheme({ defs: { brand: "#abc" }, theme: { accent: "brand" } }).ok).toBe(true)
  })
})
