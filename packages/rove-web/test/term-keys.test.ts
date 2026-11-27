import { expect, test } from "bun:test"
import { TERM_KEYS, ctrlChord, isShiftEnter, keyPages } from "../src/term-keys.ts"

test("Shift+Enter is the engine's newline, but not as an IME commit or with another modifier", () => {
  const press = {
    key: "Enter",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 13,
  }
  expect(isShiftEnter(press)).toBe(true)
  // Plain Enter still submits.
  expect(isShiftEnter({ ...press, shiftKey: false })).toBe(false)
  // Pinyin commit: the IME owns the key.
  expect(isShiftEnter({ ...press, isComposing: true })).toBe(false)
  expect(isShiftEnter({ ...press, keyCode: 229 })).toBe(false)
  expect(isShiftEnter({ ...press, metaKey: true })).toBe(false)
})

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

test("the key row's first page is six keys, and every key is on exactly one page", () => {
  const { first, rest } = keyPages(false)
  expect(first.map((key) => key.cap)).toEqual(["esc", "⇧tab", "^C", "↑", "↓", "⏎"])
  expect([...first, ...rest].map((key) => key.id).sort()).toEqual(TERM_KEYS.map((key) => key.id).sort())
})

test("at a menu the digits lead, with esc and Enter, and nothing else is lost", () => {
  const { first, rest } = keyPages(true)
  expect(first.map((key) => key.cap)).toEqual(["1", "2", "3", "4", "esc", "⏎"])
  expect(rest.map((key) => key.cap)).toEqual(["tab", "⇧tab", "^C", "↑", "↓", "←", "→"])
})
