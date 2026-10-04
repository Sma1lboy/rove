import { describe, expect, it } from "vitest"
import { createTerminalGraphics, outerTerminalDrawsKittyPlaceholders } from "../../src/tui/lib/terminal-graphics"

describe("outer terminal Kitty placeholder detection", () => {
  it.each([
    ["Ghostty by TERM_PROGRAM", { TERM_PROGRAM: "ghostty" }],
    ["Ghostty by resources dir", { GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app" }],
    ["kitty by window id", { KITTY_WINDOW_ID: "1" }],
    ["kitty by TERM", { TERM: "xterm-kitty" }],
  ])("accepts %s", (_name, env) => {
    expect(outerTerminalDrawsKittyPlaceholders(env)).toBe(true)
  })

  it.each([
    ["Terminal.app", { TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }],
    ["iTerm2 (answers CSI 16 t but has no placeholders)", { TERM_PROGRAM: "iTerm.app" }],
    ["a pane's scrubbed env", { TERM: "xterm-256color" }],
    ["Ghostty inside tmux", { TERM_PROGRAM: "ghostty", TMUX: "/tmp/tmux-1/default,1,0" }],
    ["Ghostty inside zellij", { GHOSTTY_RESOURCES_DIR: "/x", ZELLIJ: "0" }],
  ])("rejects %s", (_name, env) => {
    expect(outerTerminalDrawsKittyPlaceholders(env)).toBe(false)
  })

  it("writes nothing when stdout is redirected, but still reports the cell size", () => {
    const cell = { width: 9, height: 18 }
    const write = () => {}
    const redirected = createTerminalGraphics({
      env: { TERM_PROGRAM: "ghostty" },
      stdoutIsTTY: false,
      cellPixelSize: cell,
      write,
    })
    expect(redirected).toEqual({ cellPixelSize: cell, writeKitty: null })
    const tty = createTerminalGraphics({
      env: { TERM_PROGRAM: "ghostty" },
      stdoutIsTTY: true,
      cellPixelSize: cell,
      write,
    })
    expect(tty.writeKitty).toBe(write)
  })
})
