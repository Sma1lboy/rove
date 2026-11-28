import { expect, test } from "bun:test"
import { contrast, cssVars, fontFamilyFor, monoFontStack, terminalFontStack, xtermTheme } from "../src/prefs-theme.ts"

const prefs = { focusAccent: "primary", colorblind: "off" } as const

// claude's muted and line-number greys, as the bridge resolves them.
const claudeDark = {
  textMuted: "#a9a39a",
  background: "#141413",
  backgroundPanel: "#1a1917",
  backgroundElement: "#2b2a27",
  backgroundMenu: "#33312e",
  diffLineNumber: "#6b665f",
}
const claudeLight = {
  textMuted: "#5e5953",
  background: "#faf9f5",
  backgroundPanel: "#f0eee6",
  backgroundElement: "#eae7df",
  backgroundMenu: "#e2ded4",
  diffLineNumber: "#8d877d",
}

const surfaces = (palette: typeof claudeDark) => [
  palette.background,
  palette.backgroundPanel,
  palette.backgroundElement,
  palette.backgroundMenu,
]

test.each([
  ["dark", claudeDark, true],
  ["light", claudeLight, false],
] as const)(
  "--subtle holds AA on every surface of a %s page, lightening on dark and darkening on light",
  (_, palette, lighter) => {
    const subtle = cssVars(palette, prefs)["--subtle"] as string
    expect(Math.min(...surfaces(palette).map((s) => contrast(subtle, s)))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(subtle, "#000000") > contrast(palette.diffLineNumber, "#000000")).toBe(lighter)
  },
)

test("--subtle keeps a grey that already reads", () => {
  const conductorLight = { ...claudeLight, diffLineNumber: "#5b5b5b" }
  expect(cssVars(conductorLight, prefs)["--subtle"]).toBe("#5b5b5b")
})

test("--muted stays a step stronger than --subtle when raising subtle to AA would overtake it", () => {
  // A light theme whose muted grey sits just past AA: subtle, raised to AA, lands darker than it.
  const inverted = { ...claudeLight, textMuted: "#6b665f" }
  const vars = cssVars(inverted, prefs)
  const muted = surfaces(inverted).map((s) => contrast(vars["--muted"] as string, s))
  const subtle = surfaces(inverted).map((s) => contrast(vars["--subtle"] as string, s))
  expect(muted.filter((m, i) => m <= (subtle[i] as number))).toEqual([])
  expect(Math.min(...muted)).toBeGreaterThanOrEqual(4.5)
})

test("--muted keeps a theme grey that already reads above --subtle", () => {
  expect(cssVars(claudeLight, prefs)["--muted"]).toBe("#5e5953")
  expect(cssVars(claudeDark, prefs)["--muted"]).toBe("#a9a39a")
})

test.each([
  ["dark", claudeDark],
  ["light", claudeLight],
] as const)("the docked rail on a %s page is a hair darker than it: one surface, barely parted", (_, palette) => {
  const vars = cssVars(palette, prefs)
  const step = contrast(vars["--sidebar"] as string, palette.background)
  expect(step).toBeGreaterThan(1.01)
  expect(step).toBeLessThan(1.05)
  expect(contrast(vars["--sidebar"] as string, "#000000")).toBeLessThan(contrast(palette.background, "#000000"))
})

test("fontFamilyFor reads a theme's optional fontFamily and stacks keep Rove Nerd Symbols", () => {
  const themes = [
    { name: "claude", bundled: true, dark: claudeDark, light: claudeLight },
    { name: "ghostty", bundled: false, fontFamily: "Berkeley Mono", dark: claudeDark, light: claudeLight },
  ]
  expect(fontFamilyFor(themes, "ghostty")).toBe("Berkeley Mono")
  expect(fontFamilyFor(themes, "claude")).toBeNull()
  expect(monoFontStack("Berkeley Mono")).toStartWith('"Berkeley Mono", "Rove Nerd Symbols",')
  expect(terminalFontStack("Berkeley Mono")).toStartWith('"Berkeley Mono", "Rove Nerd Symbols",')
})

test("xtermTheme uses explicit cursor and ANSI 0-15 slots when present, and falls back otherwise", () => {
  const base = {
    background: "#141413",
    text: "#eae7df",
    primary: "#cc785c",
    backgroundMenu: "#33312e",
    error: "#ec6f74",
    success: "#9aca86",
    warning: "#e8c96b",
    info: "#61aaf2",
    syntaxType: "#9b87f5",
    secondary: "#d4967e",
    textMuted: "#a9a39a",
    diffLineNumber: "#6b665f",
  }
  const fallback = xtermTheme(base)
  expect(fallback.cursor).toBe("#cc785c")
  expect(fallback.red).toBe("#ec6f74")

  const imported = xtermTheme({
    ...base,
    cursor: "#f5e0dc",
    terminalRed: "#f38ba8",
    terminalBrightBlue: "#89b4fa",
  })
  expect(imported.cursor).toBe("#f5e0dc")
  expect(imported.red).toBe("#f38ba8")
  expect(imported.brightBlue).toBe("#89b4fa")
})
