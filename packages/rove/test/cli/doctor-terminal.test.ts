/**
 * `rove doctor` terminal section — pure halves only (env formatting + kitty
 * probe reply parsing). Why this matters: keyboard bugs are terminal-
 * dependent (Terminal.app's legacy key path breaks ctrl+h/j, and the two
 * split chords in docs/KEYBINDINGS.md need the kitty protocol outright), and
 * doctor's terminal line is how a reporter tells us which key path they are
 * on without a screen recording. The live TTY probe is I/O-thin and untested
 * by design.
 */

import { describe, expect, test } from "vitest"
import { multiplexerLabel, parseKittyProbeReply } from "../../src/cli/doctor-terminal"

describe("multiplexerLabel", () => {
  test("names whichever multiplexer wrapped the session", () => {
    // Rove dropped its own tmux RUNTIME, but a user running Rove inside one
    // still gets their keys rewritten on the way in — the confound a
    // keyboard report has to rule out. All three set a marker.
    expect(multiplexerLabel({ TMUX: "/tmp/tmux-501/default,1,0" })).toBe("tmux")
    expect(multiplexerLabel({ ZELLIJ: "0" })).toBe("zellij")
    expect(multiplexerLabel({ STY: "1234.pts-0.host" })).toBe("screen")
    expect(multiplexerLabel({})).toBe("no")
  })
})

describe("parseKittyProbeReply", () => {
  test("kitty flags reply → supported with parsed flags", () => {
    expect(parseKittyProbeReply("\x1b[?1u")).toEqual({ kind: "supported", flags: 1 })
    expect(parseKittyProbeReply("\x1b[?31u\x1b[?62;c")).toEqual({ kind: "supported", flags: 31 })
  })

  test("DA1 reply without a kitty reply → unsupported (the fence answered first)", () => {
    expect(parseKittyProbeReply("\x1b[?62;22;52c")).toEqual({ kind: "unsupported" })
    expect(parseKittyProbeReply("\x1b[?1;2c")).toEqual({ kind: "unsupported" })
  })

  test("partial buffer → null (keep reading)", () => {
    expect(parseKittyProbeReply("")).toBeNull()
    expect(parseKittyProbeReply("\x1b[?6")).toBeNull()
  })
})
