import { expect, test } from "bun:test"
import { TERM_KEYS, ctrlChord } from "../src/term-keys.ts"

test("the touch Ctrl key turns the next typed character into its control byte", () => {
  expect(ctrlChord("c")).toBe("\x03")
  expect(ctrlChord("C")).toBe("\x03")
  expect(ctrlChord("[")).toBe("\x1b")
  expect(ctrlChord(" ")).toBe("\x00")
  // No Ctrl chord: the character goes through as typed.
  expect(ctrlChord("1")).toBe("1")
  expect(ctrlChord("ab")).toBe("ab")
})

test("arrow keys follow the app's cursor-key mode", () => {
  const up = TERM_KEYS.find((key) => key.id === "up")
  expect(up?.bytes(false)).toBe("\x1b[A")
  expect(up?.bytes(true)).toBe("\x1bOA")
})
