import { describe, expect, it } from "vitest"
import { ptyEnv } from "../pty-env.mjs"

describe("ptyEnv", () => {
  it("removes launcher color suppression and outer terminal identity", () => {
    const base = {
      NO_COLOR: "1",
      TERM_PROGRAM: "iTerm.app",
      TERM_PROGRAM_VERSION: "3.6.11",
      TERM: "xterm-256color",
    }

    // The contract is removals + additions, per the test name — not the exact
    // key set, which turns every new passthrough var into a red.
    const env = ptyEnv(base)
    expect(env).not.toHaveProperty("NO_COLOR")
    expect(env).not.toHaveProperty("TERM_PROGRAM")
    expect(env).not.toHaveProperty("TERM_PROGRAM_VERSION")
    expect(env).toMatchObject({
      TERM: "xterm-256color",
      CLICOLOR: "1",
      COLORTERM: "truecolor",
    })
    expect(base.NO_COLOR).toBe("1")
  })
})
