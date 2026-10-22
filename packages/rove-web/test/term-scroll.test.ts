import { expect, test } from "bun:test"
import { linesFromBottom, viewportAfterWrite, wheelLines, wheelOwner } from "../src/term-scroll.ts"

test("the wheel goes to the app only when it tracks the mouse or owns the alternate screen (TUI emulator order)", () => {
  expect(wheelOwner({ alternateScreen: false, mouseTracking: false })).toBe("local")
  expect(wheelOwner({ alternateScreen: true, mouseTracking: false })).toBe("app")
  expect(wheelOwner({ alternateScreen: false, mouseTracking: true })).toBe("app")
  expect(wheelOwner({ alternateScreen: true, mouseTracking: true })).toBe("app")
})

test("sub-line touchpad deltas add up to whole lines instead of being dropped", () => {
  let carry = 0
  let lines = 0
  for (let i = 0; i < 10; i++) {
    const step = wheelLines(carry, { deltaY: -3, deltaMode: 0 }, 15, 40)
    carry = step.carry
    lines += step.lines
  }
  // 10 × 3px over 15px rows = two rows up.
  expect(lines).toBe(-2)
  expect(Math.abs(carry)).toBeLessThan(1e-9)
})

test("a change of direction starts from zero", () => {
  const up = wheelLines(0, { deltaY: -12, deltaMode: 0 }, 15, 40)
  expect(up.lines).toBe(0)
  const down = wheelLines(up.carry, { deltaY: 9, deltaMode: 0 }, 15, 40)
  expect(down.lines).toBe(0)
  expect(down.carry).toBeCloseTo(0.6)
})

test("line and page delta modes scroll lines and screens", () => {
  expect(wheelLines(0, { deltaY: -3, deltaMode: 1 }, 15, 40).lines).toBe(-3)
  expect(wheelLines(0, { deltaY: 1, deltaMode: 2 }, 15, 40).lines).toBe(40)
  // A mouse notch (100px) over 15px rows.
  expect(wheelLines(0, { deltaY: -100, deltaMode: 0 }, 15, 40).lines).toBe(-6)
})

test("lines from the bottom never go negative", () => {
  expect(linesFromBottom({ baseY: 100, viewportY: 100 })).toBe(0)
  expect(linesFromBottom({ baseY: 100, viewportY: 60 })).toBe(40)
  expect(linesFromBottom({ baseY: 0, viewportY: 3 })).toBe(0)
})

test("a view at the bottom, or one nothing wiped under, is left to xterm", () => {
  expect(viewportAfterWrite(null, { baseY: 500, viewportY: 500 })).toBeNull()
  expect(viewportAfterWrite(null, { baseY: 500, viewportY: 120 })).toBeNull()
  expect(viewportAfterWrite(0, { baseY: 500, viewportY: 500 })).toBeNull()
})

test("after a scrollback wipe a scrolled view keeps its distance from the bottom", () => {
  // Scrolled 40 lines back, the app cleared and repainted: xterm left the view at the top.
  expect(viewportAfterWrite(40, { baseY: 300, viewportY: 0 })).toBe(260)
  // Already there: nothing to do.
  expect(viewportAfterWrite(40, { baseY: 300, viewportY: 260 })).toBeNull()
  // The repaint is shorter than the old distance: as far back as it goes.
  expect(viewportAfterWrite(40, { baseY: 25, viewportY: 25 })).toBe(0)
})
