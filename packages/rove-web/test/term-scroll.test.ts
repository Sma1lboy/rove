import { expect, test } from "bun:test"
import {
  edgeCarry,
  glideStep,
  isWheelNotch,
  linesFromBottom,
  scrollStep,
  viewportAfterWrite,
  wheelDelta,
  wheelOwner,
} from "../src/term-scroll.ts"

test("the wheel scrolls the normal screen's scrollback even when the app tracks the mouse; Shift or the alternate screen hands it over", () => {
  const owner = (alternateScreen: boolean, mouseTracking: boolean, shift = false) =>
    wheelOwner({ alternateScreen, mouseTracking, shift })
  expect(owner(false, false)).toBe("local")
  // An inline app with 1003 on (omp) cannot scroll the scrollback itself.
  expect(owner(false, true)).toBe("local")
  expect(owner(false, true, true)).toBe("app")
  expect(owner(false, false, true)).toBe("local")
  expect(owner(true, false)).toBe("app")
  expect(owner(true, true)).toBe("app")
})

test("sub-line touchpad deltas add up and leave at most half a line as the screen offset", () => {
  let carry = 0
  let lines = 0
  for (let i = 0; i < 100; i++) {
    const step = scrollStep(carry, wheelDelta({ deltaY: -3, deltaMode: 0 }, 15, 40))
    carry = step.carry
    lines += step.lines
    expect(Math.abs(carry)).toBeLessThanOrEqual(0.5)
  }
  // 100 × 3px over 15px rows = twenty rows up, nothing dropped.
  expect(lines).toBe(-20)
  expect(carry).toBeCloseTo(0)
})

test("a change of direction carries the offset instead of snapping the view", () => {
  const up = scrollStep(0, -0.4)
  expect(up).toEqual({ lines: 0, carry: -0.4 })
  // Back down by 0.3: the view is 0.1 line above where it started, not 0.3 below it.
  const down = scrollStep(up.carry, 0.3)
  expect(down.lines).toBe(0)
  expect(down.carry).toBeCloseTo(-0.1)
  // Past the half line the row changes and the offset flips sign, the picture unchanged.
  const over = scrollStep(0.4, 0.2)
  expect(over.lines).toBe(1)
  expect(over.carry).toBeCloseTo(-0.4)
  expect(scrollStep(-0.4, -0.2)).toEqual({ lines: -1, carry: expect.closeTo(0.4) })
})

test("a view against the buffer's edge keeps no offset toward it", () => {
  expect(edgeCarry(0.3, { baseY: 100, viewportY: 100 })).toBe(0)
  expect(edgeCarry(-0.3, { baseY: 100, viewportY: 100 })).toBe(-0.3)
  expect(edgeCarry(-0.3, { baseY: 100, viewportY: 0 })).toBe(0)
  expect(edgeCarry(0.3, { baseY: 100, viewportY: 0 })).toBe(0.3)
  expect(edgeCarry(0.3, { baseY: 0, viewportY: 0 })).toBe(0)
})

test("line and page delta modes scroll lines and screens, a pixel delta rows of the cell's height", () => {
  expect(wheelDelta({ deltaY: -3, deltaMode: 1 }, 15, 40)).toBe(-3)
  expect(wheelDelta({ deltaY: 1, deltaMode: 2 }, 15, 40)).toBe(40)
  expect(wheelDelta({ deltaY: -150, deltaMode: 0 }, 15, 40)).toBe(-10)
})

test("a mouse notch glides while a touchpad stream is followed as it comes", () => {
  expect(isWheelNotch({ deltaY: 3, deltaMode: 1 })).toBe(true)
  // Chromium on Windows and Linux: 100px, wheelDeltaY 120.
  expect(isWheelNotch({ deltaY: 100, deltaMode: 0, wheelDeltaY: -120 })).toBe(true)
  // Chromium on a Mac reports three times the pixels, so 40px is 120 there without being a notch.
  expect(isWheelNotch({ deltaY: 40, deltaMode: 0, wheelDeltaY: -120 })).toBe(false)
  expect(isWheelNotch({ deltaY: 6, deltaMode: 0, wheelDeltaY: -18 })).toBe(false)
  expect(isWheelNotch({ deltaY: 6, deltaMode: 0 })).toBe(false)
})

test("a glide moves all of what it was given, never past it, and ends exactly", () => {
  for (const total of [3, -3, 0.5, -40]) {
    let pending = total
    let moved = 0
    let frames = 0
    while (pending !== 0 && frames++ < 600) {
      const part = glideStep(pending, 16)
      expect(Math.sign(part)).toBe(Math.sign(pending))
      expect(Math.abs(part)).toBeLessThanOrEqual(Math.abs(pending))
      pending -= part
      moved += part
    }
    expect(moved).toBeCloseTo(total, 9)
    // A notch is home well inside half a second at 60 fps.
    expect(frames).toBeLessThan(40)
  }
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
