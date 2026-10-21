import { describe, expect, test } from "vitest"
import { relayCommand, useStdioTransport } from "../../src/machines/stdio-forward.ts"

describe("stdio transport", () => {
  test("native Windows always relays; elsewhere only when asked", () => {
    expect(useStdioTransport("win32")).toBe(true)
    const prev = process.env.ROVE_MACHINE_TRANSPORT
    try {
      delete process.env.ROVE_MACHINE_TRANSPORT
      expect(useStdioTransport("linux")).toBe(false)
      process.env.ROVE_MACHINE_TRANSPORT = "stdio"
      expect(useStdioTransport("darwin")).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.ROVE_MACHINE_TRANSPORT
      else process.env.ROVE_MACHINE_TRANSPORT = prev
    }
  })

  test("the relay runs the machine's own rove, with its directory on PATH for an nvm shebang", () => {
    expect(relayCommand(undefined, false)).toBe("rove daemon relay")
    expect(relayCommand(undefined, true)).toBe("rove daemon relay --pty")
    const nvm = relayCommand("/Users/me/.nvm/versions/node/v22/bin/rove", true)
    expect(nvm).toContain("PATH='/Users/me/.nvm/versions/node/v22/bin'")
    expect(nvm.endsWith("daemon relay --pty")).toBe(true)
  })
})
