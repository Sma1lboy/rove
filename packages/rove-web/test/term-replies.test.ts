import { expect, test } from "bun:test"
import { createReplyGate } from "../src/term-replies.ts"

function gate() {
  const sent: string[] = []
  return { sent, ...createReplyGate((data) => sent.push(data)) }
}

test("replies xterm makes while it parses the replayed ring never reach the app", () => {
  const g = gate()
  let parsed = () => {}
  g.replay((done) => {
    parsed = done
  })

  // Old `ESC[c`, `ESC[6n`, `ESC[?2004$p`, OSC 11 and XTVERSION from the previous process, answered as xterm parses them.
  g.forward("\x1b[?1;2c")
  g.forward("\x1b[12;1R")
  g.forward("\x1b[?2004;2$y")
  g.forward("\x1b]11;rgb:1414/1414/1313\x1b\\")
  g.forward("\x1bP>|xterm.js(6.0.0)\x1b\\")
  parsed()

  expect(g.sent).toEqual([])
})

test("keys typed while a replay parses still reach the app", () => {
  const g = gate()
  g.replay(() => {})

  // Ctrl+C on a flood lands mid-repaint; arrows and text too.
  g.forward("\x03")
  g.forward("\x1b[A")
  g.forward("q")

  expect(g.sent).toEqual(["\x03", "\x1b[A", "q"])
})

test("keys and cursor-position replies go through once the replay is parsed", () => {
  const g = gate()
  g.replay((done) => done())

  g.forward("ls\r")
  g.forward("\x1b[12;1R")

  expect(g.sent).toEqual(["ls\r", "\x1b[12;1R"])
})

test("a second replay keeps the gate shut until both have parsed", () => {
  const g = gate()
  const parsed: Array<() => void> = []
  g.replay((done) => parsed.push(done))
  g.replay((done) => parsed.push(done))

  parsed[0]?.()
  g.forward("\x1b[1;1R")
  parsed[1]?.()
  g.forward("\x1b[1;1R")

  expect(g.sent).toEqual(["\x1b[1;1R"])
})

test("live replies the PTY host already sent are dropped, the ones only xterm can answer are kept", () => {
  const g = gate()

  g.forward("\x1b[?1;2c")
  g.forward("\x1b[?2004;2$y")
  g.forward("\x1b[4;1$y")
  g.forward("\x1b]11;rgb:1414/1414/1313\x1b\\")
  g.forward("\x1b]10;rgb:fafa/f9f9/f5f5\x07")
  g.forward("\x1b[>0;276;0c")
  g.forward("\x1b[12;1R")
  g.forward("\x1b[0n")
  g.forward("\x1b[I")

  expect(g.sent).toEqual(["\x1b[>0;276;0c", "\x1b[12;1R", "\x1b[0n", "\x1b[I"])
})

test("typing that arrives glued to a dropped reply is kept", () => {
  const g = gate()

  g.forward("a\x1b[?1;2cb")

  expect(g.sent).toEqual(["ab"])
})
