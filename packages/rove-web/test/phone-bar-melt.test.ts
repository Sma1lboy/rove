import { expect, test } from "bun:test"
import { barBlobs } from "../src/ui/phone.tsx"

const main = { left: 12, width: 366 }

test("two pieces melt from their own outlines", () => {
  const capsule = { left: 16, width: 107 }
  expect(barBlobs({ capsule, main }, 128)).toEqual([capsule, main])
})

test("one bar is two blobs that cover it exactly and lap across the seam", () => {
  const [a, b] = barBlobs({ capsule: null, main }, 128)
  expect(a.left).toBe(12)
  expect(b.left + b.width).toBe(12 + 366)
  // Lapped by a corner radius each way, so neither blob's round corners show inside the bar.
  expect(a.left + a.width - b.left).toBe(28)
})
