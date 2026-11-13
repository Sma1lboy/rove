/**
 * The Windows detached launcher — the shape of the spawn, never a real
 * PowerShell. What it must get right: the child's command line survives
 * MSVCRT's argv parser, the launcher's parameters ride the env (nothing to
 * quote twice), and the launcher itself is spawned in the one shape Bun
 * honours on Windows (`windowsHide` + `stdio: "ignore"`).
 */

import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import {
  LAUNCH_CMD_ENV,
  LAUNCH_LOG_ENV,
  WIN_DETACHED_LAUNCHER_PS,
  spawnWindowsDetached,
  windowsCommandLine,
} from "../../../rove-daemon/src/client/win-detached-launch.ts"

describe("windowsCommandLine (MSVCRT argv quoting)", () => {
  it("quotes an argument with a space and doubles only the backslashes before the closing quote", () => {
    expect(windowsCommandLine(["C:\\Program Files\\Git\\bin\\bash.exe"])).toBe(
      '"C:\\Program Files\\Git\\bin\\bash.exe"',
    )
    expect(windowsCommandLine(["C:\\Program Files\\"])).toBe('"C:\\Program Files\\\\"')
  })

  it("escapes an embedded quote and the backslashes in front of it", () => {
    expect(windowsCommandLine(['say "hi"'])).toBe('"say \\"hi\\""')
    expect(windowsCommandLine(['a\\"b'])).toBe('"a\\\\\\"b"')
  })

  it("renders an empty argument as an empty pair of quotes", () => {
    expect(windowsCommandLine(["x", "", "y"])).toBe('x "" y')
  })
})

describe("spawnWindowsDetached", () => {
  it("spawns powershell hidden with stdio ignored, the command line and log path in the env", () => {
    const calls: { file: string; args: readonly string[]; options: Record<string, unknown> }[] = []
    const fakeSpawn = ((file: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ file, args, options })
      const child = new EventEmitter() as ChildProcess
      child.unref = () => {}
      return child
    }) as unknown as typeof import("node:child_process").spawn

    spawnWindowsDetached(
      "C:\\bun\\bun.exe",
      ["C:\\Program Files\\rove\\rove-run.js", "daemon", "start"],
      { PATH: "x", SystemRoot: "C:\\Windows" },
      "C:\\Users\\me\\.rove\\daemon.log",
      fakeSpawn,
    )

    expect(calls).toHaveLength(1)
    const [{ file, args, options }] = calls
    expect(file.toLowerCase()).toContain("powershell.exe")
    expect(args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"])
    expect(Buffer.from(args[5] as string, "base64").toString("utf16le")).toBe(WIN_DETACHED_LAUNCHER_PS)
    expect(options.windowsHide).toBe(true)
    expect(options.stdio).toBe("ignore")
    const env = options.env as Record<string, string>
    expect(env.PATH).toBe("x")
    expect(env[LAUNCH_CMD_ENV]).toBe('C:\\bun\\bun.exe "C:\\Program Files\\rove\\rove-run.js" daemon start')
    expect(env[LAUNCH_LOG_ENV]).toBe("C:\\Users\\me\\.rove\\daemon.log")
  })
})
