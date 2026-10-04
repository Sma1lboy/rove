import { describe, expect, it, vi } from "vitest"
import { ROVE_TERMINAL_TITLE_SEQUENCE, publishRoveTerminalTitle } from "../../src/tui/lib/outer-terminal-title.ts"

describe("publishRoveTerminalTitle", () => {
  it("writes the OSC 0 rove title to a terminal", () => {
    const write = vi.fn()
    expect(publishRoveTerminalTitle({ isTTY: true, write })).toBe(true)
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith(ROVE_TERMINAL_TITLE_SEQUENCE)
  })

  it("does not leak control bytes into redirected output", () => {
    const write = vi.fn()
    expect(publishRoveTerminalTitle({ isTTY: false, write })).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })
})
