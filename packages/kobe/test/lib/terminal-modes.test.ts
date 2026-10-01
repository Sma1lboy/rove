/**
 * The PTY host stands in for the TUI's emulator while none is attached, so
 * its DA1/DECRQM answers and its replay preamble are judged against a real
 * @xterm/headless fed the same bytes.
 */

import { freshModeTrack, scanTerminalModes, terminalModePreamble } from "@sma1lboy/kobe-daemon/daemon/terminal-modes"
import { Terminal } from "@xterm/headless"
import { describe, expect, it } from "vitest"

async function xtermAfter(output: string): Promise<{ term: Terminal; replies: string }> {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  let replies = ""
  term.onData((data) => {
    replies += data
  })
  await new Promise<void>((resolve) => term.write(output, resolve))
  return { term, replies }
}

const PRIVATE_MODES = [
  1, 3, 6, 7, 8, 9, 12, 25, 45, 66, 67, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 1047, 1048, 1049, 2004, 2026,
  5522,
]
const ANSI_MODES = [2, 4, 12, 20, 34]

const SETUPS: Record<string, string> = {
  fresh: "",
  "engine startup": "\x1b[?2004h\x1b[?1l\x1b>\x1b[?1000h\x1b[?1003h\x1b[?1006h\x1b[?2026h\x1b[?25l",
  "full-screen app": "\x1b[?1049h\x1b[?1h\x1b=\x1b[?1002;1016h\x1b[?7l\x1b[4h\x1b[?12h\x1b[?1004h",
  "mouse off again": "\x1b[?1003h\x1b[?1006h\x1b[?1000l\x1b[?1016l",
  "soft reset": "\x1b[?1h\x1b[?2004h\x1b[?1003h\x1b[?25l\x1b[!p",
  "full reset": "\x1b[?1049h\x1b[?1003h\x1b[?2004h\x1bc",
}

describe("terminal mode tracking", () => {
  for (const [name, setup] of Object.entries(SETUPS)) {
    it(`answers DA1 and DECRQM exactly as xterm.js after ${name}`, async () => {
      const queries = [
        "\x1b[c",
        "\x1b[0c",
        ...PRIVATE_MODES.map((mode) => `\x1b[?${mode}$p`),
        ...ANSI_MODES.map((mode) => `\x1b[${mode}$p`),
      ].join("")
      const track = freshModeTrack()
      // One byte at a time: every sequence straddles a chunk boundary.
      const hostReplies = [...(setup + queries)].flatMap((byte) => scanTerminalModes(track, byte)).join("")
      const { replies } = await xtermAfter(setup + queries)
      expect(hostReplies).toBe(replies)
    })

    it(`replays the modes of a trimmed ring (${name})`, async () => {
      const track = freshModeTrack()
      scanTerminalModes(track, setup)
      const original = await xtermAfter(setup)
      const replayed = await xtermAfter(terminalModePreamble(track.modes))
      // Synchronized output is mid-frame at a ring cut; the ring carries its end.
      expect({ ...replayed.term.modes, synchronizedOutputMode: false }).toEqual({
        ...original.term.modes,
        synchronizedOutputMode: false,
      })
      expect(replayed.term.modes.synchronizedOutputMode).toBe(false)
      expect(replayed.term.buffer.active.type).toBe(original.term.buffer.active.type)
    })
  }
})
