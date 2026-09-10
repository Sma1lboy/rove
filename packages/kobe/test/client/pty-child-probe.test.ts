/**
 * The pty host's live-child probe — the guard that decides whether a wedged
 * host may be reaped.
 *
 * Every Windows case injects platform + disk + the child runner, exactly as
 * `node-pty-host-spawn.test.ts` does: those branches only ever execute on
 * Windows, so on a POSIX CI host injection is the only reason they are tested
 * at all. The two real spawns here are `process.execPath`, which is node on
 * every runner this file lands on.
 */

import {
  type ChildProbeDeps,
  childProbeCommand,
  liveChildCount,
  runChildProbe,
} from "@sma1lboy/kobe-daemon/client/pty-process"
import { describe, expect, it } from "vitest"

const ENV = { SystemRoot: "C:\\Windows", PATH: "C:\\tools\\bin" }
/** `node:path` resolves with the HOST's separators, so assertions must not
 *  care whether the runner produced `C:\Windows\…` or `/Windows/…`. */
const norm = (path: string) => path.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "")
const PS = "/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
const diskWith = (...present: string[]) => {
  const set = new Set(present)
  return (path: string) => set.has(norm(path))
}
const win = (over: ChildProbeDeps = {}): ChildProbeDeps => ({ platform: "win32", env: ENV, ...over })
/** A child runner that answers with a fixed table, recording what it was asked. */
const table = (out: string, seen: string[][] = []) => {
  const run = async (command: readonly string[]): Promise<string> => {
    seen.push([...command])
    return out
  }
  return { run, seen }
}

describe("childProbeCommand", () => {
  it("keeps POSIX on `ps`", () => {
    expect(childProbeCommand({ platform: "linux" })).toEqual(["ps", "-A", "-o", "ppid="])
    expect(childProbeCommand({ platform: "darwin" })).toEqual(["ps", "-A", "-o", "ppid="])
  })

  it("reads the Windows table with PowerShell 5.1 by absolute path", () => {
    const cmd = childProbeCommand(win({ exists: diskWith(PS) }))
    // Normalised: `node:path` joins with the HOST's separators, so this file
    // has to be green on a POSIX runner and on a contributor's Windows box.
    expect(norm(cmd[0] ?? "")).toBe(PS)
    // NoProfile/NonInteractive: a profile that prompts or an interactive
    // prompt is a probe that never answers.
    expect(cmd.slice(1, 3)).toEqual(["-NoProfile", "-NonInteractive"])
    const script = cmd[cmd.length - 1] ?? ""
    // 5.1, not 7: no `&&`, no ternaries, no `??`. Get-CimInstance is in 5.1;
    // the shorter Get-Process has no ParentProcessId at all.
    expect(script).toContain("Get-CimInstance -ClassName Win32_Process")
    expect(script).not.toContain("&&")
    // One ParentProcessId per line — the same shape `ps -o ppid=` prints, so
    // one parser reads both platforms.
    expect(script).toContain("Select-Object -ExpandProperty ParentProcessId")
    // Under an OEM codepage (936 on a Chinese Windows) 5.1 writes its stdout
    // in that codepage; pinning UTF-8 keeps the read honest.
    expect(script).toContain("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8")
  })

  it("falls back to a bare `powershell` when System32 is not where SystemRoot says", () => {
    expect(childProbeCommand(win({ exists: diskWith() }))[0]).toBe("powershell.exe")
    // And a machine with no SystemRoot/windir at all still gets one.
    expect(childProbeCommand(win({ env: {}, exists: diskWith() }))[0]).toBe("powershell.exe")
  })
})

describe("liveChildCount", () => {
  it("counts the rows whose ppid is the host", async () => {
    const { run } = table(" 1 \n4242\n7\n4242\r\n")
    expect(await liveChildCount(4242, { platform: "linux", run })).toBe(2)
    expect(await liveChildCount(999, { platform: "linux", run })).toBe(0)
  })

  it("answers null — never zero — when the table could not be read", async () => {
    // The regression this file exists for: `/bin/ps` is ENOENT on Windows, so
    // the old `catch → 0` made "could not tell" indistinguishable from "host
    // holds no sessions", and the caller reaped a host with live engines in it.
    const { run } = table("")
    expect(await liveChildCount(1, { platform: "linux", run })).toBeNull()
    expect(
      await liveChildCount(1, {
        platform: "linux",
        run: async () => {
          throw new Error("ENOENT")
        },
      }),
    ).toBeNull()
  })

  it("asks Windows for the same number, and reads it with the same parser", async () => {
    const { run, seen } = table("4242\n8\n")
    expect(await liveChildCount(4242, win({ run, exists: diskWith(PS) }))).toBe(1)
    expect(seen[0]?.[0]).toContain("powershell")
  })

  it("bounds a probe that never answers, and kills the child it gave up on", async () => {
    // A real child, not a mock: the deadline has to fire against a process
    // that stays alive, and the abandoned one has to be killed or a long-lived
    // daemon leaks a probe per recovery attempt.
    const started = Date.now()
    await expect(
      runChildProbe([process.execPath, "-e", "setTimeout(() => {}, 30000)"], 200),
    ).rejects.toThrow(/did not answer within 200ms/)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it("reads a real child's stdout to completion", async () => {
    // The only real spawn of the happy path: `process.execPath` is node on
    // every runner, so this asserts the accumulate-and-resolve, not the OS.
    const out = await runChildProbe([process.execPath, "-e", "process.stdout.write('7\\n9\\n')"], 10_000)
    expect(out.split("\n").filter((row) => row.trim() === "9")).toHaveLength(1)
  })
})
