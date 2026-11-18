import { afterEach, describe, expect, test, vi } from "vitest"
import { relayCommand, useStdioTransport } from "../../src/machines/stdio-forward.ts"

describe("stdio transport", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test("native Windows always relays; elsewhere only when asked", () => {
    expect(useStdioTransport("win32")).toBe(true)
    vi.stubEnv("ROVE_MACHINE_TRANSPORT", undefined)
    expect(useStdioTransport("linux")).toBe(false)
    vi.stubEnv("ROVE_MACHINE_TRANSPORT", "stdio")
    expect(useStdioTransport("darwin")).toBe(true)
  })

  test("the relay runs the machine's own rove, with its directory on PATH for an nvm shebang", () => {
    expect(relayCommand({}, false)).toBe("rove daemon relay")
    expect(relayCommand({}, true)).toBe("rove daemon relay --pty")
    const nvm = relayCommand({ roveBin: "/Users/me/.nvm/versions/node/v22/bin/rove" }, true)
    expect(nvm).toContain("PATH='/Users/me/.nvm/versions/node/v22/bin'")
    expect(nvm.endsWith("daemon relay --pty")).toBe(true)
  })
})
