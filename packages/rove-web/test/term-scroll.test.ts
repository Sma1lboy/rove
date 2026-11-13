import { expect, test } from "bun:test"
import {
  type CoastState,
  appWheel,
  coastStep,
  edgeCarry,
  glideStep,
  isWheelNotch,
  linesFromBottom,
  scrollStep,
  takeWholeLines,
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

/** Feeds `deltas` through a carry-keeping step, totalling the lines and the largest offset left on the way. */
const addUp = (step: typeof scrollStep, deltas: readonly number[]) =>
  deltas.reduce(
    (sum, delta) => {
      const taken = step(sum.carry, delta)
      return {
        lines: sum.lines + taken.lines,
        carry: taken.carry,
        widest: Math.max(sum.widest, Math.abs(taken.carry)),
      }
    },
    { lines: 0, carry: 0, widest: 0 },
  )

test("sub-line touchpad deltas add up and leave at most half a line as the screen offset", () => {
  const sum = addUp(scrollStep, new Array(100).fill(wheelDelta({ deltaY: -3, deltaMode: 0 }, 15, 40)))
  expect(sum.widest).toBeLessThanOrEqual(0.5)
  // 100 × 3px over 15px rows = twenty rows up, nothing dropped.
  expect(sum.lines).toBe(-20)
  expect(sum.carry).toBeCloseTo(0)
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

/** Runs a glide of `total` frame by frame (capped at 600), counting frames that went backwards or overshot. */
const glide = (total: number) => {
  let pending = total
  let moved = 0
  let frames = 0
  let bad = 0
  while (pending !== 0 && frames++ < 600) {
    const part = glideStep(pending, 16)
    if (Math.sign(part) !== Math.sign(pending) || Math.abs(part) > Math.abs(pending)) bad++
    pending -= part
    moved += part
  }
  return { moved, frames, bad }
}

test.each([3, -3, 0.5, -40])(
  "a glide of %p moves all of what it was given, never past it, and ends exactly",
  (total) => {
    const run = glide(total)
    expect(run.bad).toBe(0)
    expect(run.moved).toBeCloseTo(total, 9)
    // A notch is home well inside half a second at 60 fps.
    expect(run.frames).toBeLessThan(40)
  },
)

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

/** Which deltas of a stream, 16ms apart unless given as `[delta, gapMs]`, are the momentum's tail. */
const coasted = (stream: readonly (number | readonly [number, number])[]): number[] => {
  let state: CoastState | null = null
  let at = 0
  const out: number[] = []
  for (const item of stream) {
    const [delta, gap] = typeof item === "number" ? [item, 16] : item
    at += gap
    state = coastStep(state, delta, at)
    if (state.coasting) out.push(delta)
  }
  return out
}

test("the crawl after a flick is momentum, the flick itself is not", () => {
  expect(coasted([4, 8, 12, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1, 1])).toEqual([2, 2, 1, 1, 1])
})

test("a slow steady drag is followed, however small its deltas", () => {
  expect(coasted([1, 2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1])).toEqual([])
})

test("a jittering tail stays coasting, a new push ends it", () => {
  expect(coasted([12, 10, 8, 6, 4, 2, 1, 2, 1, 2])).toEqual([2, 1, 2, 1, 2])
  expect(coasted([12, 10, 8, 6, 4, 2, 1, 9, 2])).toEqual([2, 1])
})

test("a pause or a change of direction starts a new gesture", () => {
  expect(coasted([12, 10, 8, 6, 4, 2, [1, 200]])).toEqual([2])
  expect(coasted([12, 10, 8, 6, 4, 2, -1])).toEqual([2])
})

test("momentum dithering around the floor does not read as a new push", () => {
  expect(coasted([40, 30, 20, 12, 8, 5, 3, 2, 3, 2, 3, 2])).toEqual([2, 2, 2])
})

test("an app-owned wheel sends one event per row of travel, in the protocol the app asked for", () => {
  const tracked = { mouseTracking: true, applicationCursorKeys: false }
  expect(appWheel(tracked, -2, 5, 9)).toBe("\x1b[<64;5;9M\x1b[<64;5;9M")
  expect(appWheel(tracked, 1, 0, 0)).toBe("\x1b[<65;1;1M")
  // No mouse reporting: arrow keys, as the TUI pane sends them.
  expect(appWheel({ mouseTracking: false, applicationCursorKeys: false }, 1, 1, 1)).toBe("\x1b[B\x1b[B\x1b[B")
  expect(appWheel({ mouseTracking: false, applicationCursorKeys: true }, -1, 1, 1)).toBe("\x1bOA\x1bOA\x1bOA")
})

test("a trackpad's small deltas add up to whole rows, and a turn the other way starts over", () => {
  // Sixty 8px events over 19px rows: about 25 rows, where one report per event after damping gave 7.
  expect(addUp(takeWholeLines, new Array(60).fill(8 / 19)).lines).toBe(25)
  expect(takeWholeLines(0.9, -0.3)).toEqual({ lines: 0, carry: -0.3 })
})
