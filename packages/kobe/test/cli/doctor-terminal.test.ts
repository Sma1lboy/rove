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
import { kittyProbeLine, multiplexerLabel, parseKittyProbeReply, terminalEnvLines } from "../../src/cli/doctor-terminal"

describe("terminalEnvLines", () => {
  test("formats TERM / TERM_PROGRAM(+version) / COLORTERM and multiplexer nesting", () => {
    const lines = terminalEnvLines({
      TERM: "xterm-256color",
      TERM_PROGRAM: "Apple_Terminal",
      TERM_PROGRAM_VERSION: "453",
      COLORTERM: undefined,
      TMUX: "/tmp/tmux-501/kobe,123,0",
    })
    expect(lines[0]).toBe("terminal: TERM=xterm-256color  TERM_PROGRAM=Apple_Terminal v453  COLORTERM=(unset)")
    expect(lines[1]).toBe("          running inside a multiplexer: tmux")
  })

  test("everything unset stays readable", () => {
    const lines = terminalEnvLines({})
    expect(lines[0]).toBe("terminal: TERM=(unset)  TERM_PROGRAM=(unset)  COLORTERM=(unset)")
    expect(lines[1]).toBe("          running inside a multiplexer: no")
  })
})

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

describe("kittyProbeLine", () => {
  test("one line per outcome, unsupported names the legacy-key consequence", () => {
    expect(kittyProbeLine({ kind: "supported", flags: 1 })).toContain("✓ answered (flags=1)")
    const unsupported = kittyProbeLine({ kind: "unsupported" })
    expect(unsupported).toContain("legacy key path")
    // Names the consequence a "split doesn't work" report is actually about
    // — docs/KEYBINDINGS.md says both split chords require this protocol.
    expect(unsupported).toContain("ctrl+=")
    expect(unsupported).toContain("ctrl+\\")
    expect(kittyProbeLine({ kind: "no-response" })).toContain("no reply")
    expect(kittyProbeLine({ kind: "skipped", reason: "not an interactive terminal" })).toContain(
      "skipped (not an interactive terminal)",
    )
  })
})
