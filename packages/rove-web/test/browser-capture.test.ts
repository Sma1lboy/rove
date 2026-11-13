import { expect, test } from "bun:test"
import { cropRect, pageIn } from "../src/browser-capture.ts"

test("the frame's box is cut out in the picture's own pixels, and never past its edge", () => {
  const viewport = { width: 1440, height: 900 }
  const retina = { width: 2880, height: 1800 }
  expect(cropRect({ left: 700, top: 80, width: 720, height: 800 }, viewport, retina)).toEqual({
    x: 1400,
    y: 160,
    width: 1440,
    height: 1600,
  })
  // A panel dragged partly off the page keeps only what the picture holds.
  expect(cropRect({ left: 1000, top: -20, width: 720, height: 800 }, viewport, retina)).toEqual({
    x: 2000,
    y: 0,
    width: 880,
    height: 1600,
  })
})

test("a shared window or screen is still cut down to the frame", () => {
  const w = {
    innerWidth: 1440,
    innerHeight: 800,
    outerWidth: 1440,
    outerHeight: 900,
    screenX: 100,
    screenY: 50,
    screen: { width: 1920, height: 1080 },
  }
  const frame = { width: 1920, height: 1080 }
  expect(pageIn("browser", frame, w)).toEqual({ left: 0, top: 0, width: 1440, height: 800 })
  expect(pageIn("window", frame, w)).toEqual({ left: 0, top: 100, width: 1440, height: 900 })
  expect(pageIn("monitor", frame, w)).toEqual({ left: 100, top: 150, width: 1920, height: 1080 })
  // No surface named: the screen-shaped picture is taken for the screen.
  expect(pageIn(undefined, frame, w)).toEqual(pageIn("monitor", frame, w))
})
