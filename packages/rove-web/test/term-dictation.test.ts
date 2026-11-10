import { expect, test } from "bun:test"
import { compositionFix, editBytes, inputFix, pasteStaysEditable } from "../src/term-dictation.ts"

const DEL = "\x7f"

test("a raw transcript replaced by its enhanced version erases the raw text and types the new one", () => {
  const raw = "呃那个帮我把这个函数改一下"
  const enhanced = "请重构这个函数。"

  // The PTY ends with the enhanced sentence alone: 13 raw characters erased, then the new text.
  expect(inputFix("insertText", enhanced, raw, enhanced)).toBe(`${DEL.repeat(13)}${enhanced}`)
})

test("an enhancement that only changes the end keeps the shared start", () => {
  expect(editBytes("我想要一个按钮", "我想要一个蓝色的按钮")).toBe(`${DEL.repeat(2)}蓝色的按钮`)
})

test("a character is one backspace whatever its width or code points", () => {
  expect(editBytes("a你𠮷👍🏽", "a")).toBe(DEL.repeat(3))
})

test("deleting then retyping through input events lands on the final text only", () => {
  expect(inputFix("deleteContentBackward", null, "hello wurld", "hello wurl")).toBe(DEL)
  expect(inputFix("insertText", "d", "hello wurl", "hello wurld")).toBeNull()
})

test("a spell-check or dictation replacement xterm ignores is carried out", () => {
  expect(inputFix("insertReplacementText", "world", "hello wurld", "hello world")).toBe(`${DEL.repeat(4)}orld`)
})

test("plain typing is left to xterm", () => {
  expect(inputFix("insertText", "你好", "", "你好")).toBeNull()
  expect(inputFix("insertText", " world", "hello", "hello world")).toBeNull()
  expect(inputFix("insertFromPaste", "pasted", "", "pasted")).toBeNull()
  expect(editBytes("same", "same")).toBe("")
})

test("a composition that only extends the text needs nothing, one that rewrote it is fixed", () => {
  // xterm sent the text past where the composition began.
  expect(compositionFix("你好", 2, "你好吗")).toBe("")
  // It began at 14 over "raw transcript": xterm sent "cript", so the PTY holds "raw transcriptcript".
  expect(compositionFix("raw transcript", 14, "Enhanced transcript")).toBe(`${DEL.repeat(19)}Enhanced transcript`)
  // A second composition that swaps a character is a replacement too.
  expect(compositionFix("你好", 2, "你们")).toBe(`${DEL}们`)
  // The textarea held a copied selection the PTY never got (nothing to erase), and xterm sent nothing for "你".
  expect(compositionFix("", 3, "你")).toBe("你")
})

test("a line that was already submitted is never erased", () => {
  expect(editBytes("first\nsecond", "first\nsecond edited")).toBe(" edited")
  expect(editBytes("first\nsecond", "first\nsecant")).toBe(`${DEL.repeat(3)}ant`)
  expect(editBytes("first\nsecond", "other")).toBe(`${DEL.repeat(6)}other`)
})

test("a pasted phrase can be replaced by a later paste; a long or multi-line paste is left alone", () => {
  const raw = "呃那个帮我把这个函数改一下"
  expect(pasteStaysEditable(raw)).toBe(true)
  // The tool selects the phrase and pastes over it: the selection is erased first, then xterm sends the paste.
  expect(editBytes(raw, "")).toBe(DEL.repeat(13))
  expect(pasteStaysEditable("line one\nline two")).toBe(false)
  expect(pasteStaysEditable("x".repeat(501))).toBe(false)
})
