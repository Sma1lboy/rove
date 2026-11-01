import { expect, test } from "bun:test"
import { cellColors, paletteColor } from "../src/term-edge.ts"
import { XTERM_THEME } from "../src/term-look.ts"

const cell = (over: Partial<Record<string, unknown>> = {}) => {
  const a = {
    bold: false,
    inverse: false,
    fg: null as number | null,
    bg: null as number | null,
    fgRgb: false,
    bgRgb: false,
    ...over,
  }
  return {
    isBold: () => (a.bold ? 1 : 0),
    isDim: () => 0,
    isInverse: () => (a.inverse ? 1 : 0),
    isFgDefault: () => a.fg === null,
    isBgDefault: () => a.bg === null,
    isFgRGB: () => a.fgRgb,
    isBgRGB: () => a.bgRgb,
    getFgColor: () => a.fg ?? 0,
    getBgColor: () => a.bg ?? 0,
  } as Parameters<typeof cellColors>[0]
}

test("the 256-colour palette runs theme sixteen, 6x6x6 cube, then greys", () => {
  expect(paletteColor(1, XTERM_THEME)).toBe(XTERM_THEME.red)
  expect(paletteColor(16, XTERM_THEME)).toBe("rgb(0,0,0)")
  expect(paletteColor(21, XTERM_THEME)).toBe("rgb(0,0,255)")
  expect(paletteColor(196, XTERM_THEME)).toBe("rgb(255,0,0)")
  expect(paletteColor(232, XTERM_THEME)).toBe("rgb(8,8,8)")
  expect(paletteColor(255, XTERM_THEME)).toBe("rgb(238,238,238)")
})

test("default cells take the theme's colours and inverse swaps them", () => {
  expect(cellColors(cell(), XTERM_THEME)).toEqual({ fg: XTERM_THEME.foreground, bg: XTERM_THEME.background })
  expect(cellColors(cell({ inverse: true }), XTERM_THEME)).toEqual({
    fg: XTERM_THEME.background,
    bg: XTERM_THEME.foreground,
  })
})

test("bold brightens the first eight palette colours only; RGB passes through", () => {
  expect(cellColors(cell({ fg: 1, bold: true }), XTERM_THEME).fg).toBe(XTERM_THEME.brightRed)
  expect(cellColors(cell({ fg: 21, bold: true }), XTERM_THEME).fg).toBe("rgb(0,0,255)")
  expect(cellColors(cell({ fg: 0x00ff7f, fgRgb: true }), XTERM_THEME).fg).toBe("#00ff7f")
  expect(cellColors(cell({ bg: 0x102030, bgRgb: true }), XTERM_THEME).bg).toBe("#102030")
})
