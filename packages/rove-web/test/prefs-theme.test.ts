import { expect, test } from "bun:test"
import { contrast, cssVars } from "../src/prefs-theme.ts"

const prefs = { focusAccent: "primary", colorblind: "off" } as const

// claude's line-number greys, as the bridge resolves them.
const claudeDark = {
  background: "#141413",
  backgroundPanel: "#1a1917",
  backgroundElement: "#2b2a27",
  backgroundMenu: "#33312e",
  diffLineNumber: "#6b665f",
}
const claudeLight = {
  background: "#faf9f5",
  backgroundPanel: "#f0eee6",
  backgroundElement: "#eae7df",
  backgroundMenu: "#e2ded4",
  diffLineNumber: "#8d877d",
}

test("--subtle holds AA on every surface, lightening on dark pages and darkening on light ones", () => {
  for (const [palette, lighter] of [
    [claudeDark, true],
    [claudeLight, false],
  ] as const) {
    const subtle = cssVars(palette, prefs)["--subtle"] as string
    for (const s of [palette.background, palette.backgroundPanel, palette.backgroundElement, palette.backgroundMenu]) {
      expect(contrast(subtle, s)).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(subtle, "#000000") > contrast(palette.diffLineNumber, "#000000")).toBe(lighter)
  }
})

test("--subtle keeps a grey that already reads", () => {
  const conductorLight = { ...claudeLight, diffLineNumber: "#5b5b5b" }
  expect(cssVars(conductorLight, prefs)["--subtle"]).toBe("#5b5b5b")
})
