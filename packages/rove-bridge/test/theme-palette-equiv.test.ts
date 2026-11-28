import { expect, test } from "bun:test"
import { paletteInks, rgbToHex, taskHex } from "@sma1lboy/rove/src/theme/palette-hex.ts"
import { BUNDLED_THEMES, type ThemeJson } from "@sma1lboy/rove/src/theme/theme-data.ts"
import { diffInks, resolveTheme } from "@sma1lboy/rove/src/tui/context/theme-core.ts"
import { taskColor } from "@sma1lboy/rove/src/tui/lib/task-color.ts"
import { palette, taskColors } from "../src/ops/theme-palette.ts"

const hex2 = (n: number) => n.toString(16).padStart(2, "0")
const old = (c: { toInts(): number[] }) => `#${c.toInts().slice(0, 3).map(hex2).join("")}`
const ids = Array.from({ length: 40 }, (_, i) => `01M3QD${String(i).padStart(4, "0")}ZEYTRQYCSWCBEZR8AY`)

test("hex palette matches the RGBA path", () => {
  let n = 0
  const odd = {
    defs: { a: "b", b: "a", warm: "rgba(200, 120, 40, 0.5)" },
    theme: {
      text: "#abc",
      background: { dark: "#101820", light: "transparent" },
      accent: "warm",
      error: "a",
      diffAdded: "nope",
    },
  } as unknown as ThemeJson
  for (const [name, json] of Object.entries({ ...BUNDLED_THEMES, odd })) {
    for (const mode of ["dark", "light"] as const) {
      const resolved = resolveTheme(json, mode)
      const cb = diffInks(resolved, true)
      const inks = paletteInks(json, mode)
      expect([name, mode, rgbToHex(inks.diffAddedColorblind)]).toEqual([name, mode, old(cb.added)])
      expect([name, mode, rgbToHex(inks.diffAddedBgColorblind)]).toEqual([name, mode, old(cb.addedBg)])
      for (const id of ids) {
        expect([name, mode, id, taskHex(id, inks)]).toEqual([name, mode, id, old(taskColor(id, resolved))])
        n++
      }
    }
  }
  expect(n).toBeGreaterThan(100)
})

test("claude dark palette output is pinned", () => {
  const p = palette(BUNDLED_THEMES.claude as ThemeJson, "dark")
  expect([p.diffAddedColorblind, p.diffAddedBgColorblind]).toEqual(["#7ec9ca", "#1c292b"])
  expect(taskColors(BUNDLED_THEMES.claude as ThemeJson, "dark", ["task-a", "task-b"])).toEqual({
    "task-a": "#cf6798",
    "task-b": "#b16ed3",
  })
})
