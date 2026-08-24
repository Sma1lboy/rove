import { describe, expect, it } from "vitest"
import { WEB_THEMES, type WebThemePalette, handleThemesRequest, mix, resolveHex } from "../../src/web/themes.ts"

/**
 * The web theme palettes are resolved at module load from the TUI's theme
 * JSONs (def-ref resolution + derived slots). The dashboard restyles by
 * setting `--color-<key>` for every key, so a palette missing a key or
 * carrying a non-hex value would break theming. Lock the contract.
 */

// Every token the web's styles.css `@theme` block declares — the SPA's
// applyTheme sets `--color-<key>` for each, so each must be present + valid.
const REQUIRED_KEYS: (keyof WebThemePalette)[] = [
  "bg",
  "surface",
  "inset",
  "menu",
  "line",
  "line-subtle",
  "line-active",
  "fg",
  "muted",
  "subtle",
  "primary",
  "primary-hover",
  "kobe-orange",
  "kobe-green",
  "kobe-blue",
  "kobe-red",
  "kobe-yellow",
  "kobe-violet",
]

const HEX = /^#[0-9a-fA-F]{6}$/

describe("WEB_THEMES", () => {
  // Mirrors BUNDLED_THEME_JSONS — the web registry is a separate import list,
  // so this list going stale is exactly how a theme ships to the TUI but not
  // the browser.
  it("ships every bundled theme", () => {
    expect(Object.keys(WEB_THEMES).sort()).toEqual(["claude", "conductor", "tokyonight"].sort())
  })

  it("every theme has every required token, all valid 6-digit hex", () => {
    for (const [name, palette] of Object.entries(WEB_THEMES)) {
      for (const key of REQUIRED_KEYS) {
        const value = palette[key]
        expect(value, `${name}.${key}`).toBeTruthy()
        expect(value, `${name}.${key} = ${value}`).toMatch(HEX)
      }
    }
  })

  it("resolves claude to its canonical dark values (def-ref chain works)", () => {
    // claude.json: background → darkBg #141413, text → darkText #EAE7DF,
    // primary → darkPrimary #CC785C. Confirms def-name → hex resolution.
    expect(WEB_THEMES.claude.bg.toLowerCase()).toBe("#141413")
    expect(WEB_THEMES.claude.fg.toLowerCase()).toBe("#eae7df")
    expect(WEB_THEMES.claude.primary.toLowerCase()).toBe("#cc785c")
  })

  it("derives distinct surface tones (bg != surface != inset for a layered theme)", () => {
    // claude has separate raised/inset surfaces — the dark-theme depth rule.
    const p = WEB_THEMES.claude
    expect(p.bg).not.toBe(p.surface)
    expect(p.surface).not.toBe(p.inset)
  })
})

describe("resolveHex", () => {
  // The theme schema (theme.schema.json) permits `#abc`, `#aabbcc`, and
  // `#aabbccdd`. The web resolver must canonicalize all three to `#rrggbb`
  // exactly like the TUI's normalizeHex — a verbatim `#abc`/`#aabbccdd` used
  // to reach mix() and blend the wrong channels for derived slots.
  const theme = { theme: {} } as Parameters<typeof resolveHex>[0]

  it("expands 3-digit shorthand hex", () => {
    expect(resolveHex(theme, "#abc")).toBe("#aabbcc")
  })

  it("passes 6-digit hex through (lowercased)", () => {
    expect(resolveHex(theme, "#AABBCC")).toBe("#aabbcc")
  })

  it("strips the alpha byte off 8-digit hex", () => {
    expect(resolveHex(theme, "#aabbccdd")).toBe("#aabbcc")
  })

  it("resolves a {dark,light} variant's shorthand hex", () => {
    expect(resolveHex(theme, { dark: "#fff", light: "#000" })).toBe("#ffffff")
  })

  it("returns null for a malformed hex rather than a garbage colour", () => {
    expect(resolveHex(theme, "#xyz")).toBeNull()
    expect(resolveHex(theme, "#12345")).toBeNull()
  })
})

describe("mix", () => {
  it("blends the true channels of a shorthand-derived colour", () => {
    // #abc expands to #aabbcc; mixing fully toward it must yield #aabbcc, not
    // the mis-parsed value the verbatim `#abc` produced.
    const white = resolveHex({ theme: {} } as Parameters<typeof resolveHex>[0], "#abc") as string
    expect(mix("#000000", white, 1)).toBe("#aabbcc")
  })

  it("returns the first colour at t=0 and the second at t=1", () => {
    expect(mix("#102030", "#a0b0c0", 0)).toBe("#102030")
    expect(mix("#102030", "#a0b0c0", 1)).toBe("#a0b0c0")
  })
})

describe("handleThemesRequest", () => {
  it("returns null for a non-themes path (falls through)", () => {
    const url = new URL("http://localhost/api/diff")
    expect(handleThemesRequest(new Request(url), url)).toBeNull()
  })

  it("serves the palettes on GET /api/themes", async () => {
    const url = new URL("http://localhost/api/themes")
    const res = handleThemesRequest(new Request(url), url)
    expect(res?.status).toBe(200)
    const json = (await res?.json()) as { themes: Record<string, WebThemePalette> }
    expect(Object.keys(json.themes)).toContain("claude")
  })

  it("405s a non-GET method", () => {
    const url = new URL("http://localhost/api/themes")
    const res = handleThemesRequest(new Request(url, { method: "POST" }), url)
    expect(res?.status).toBe(405)
  })
})
