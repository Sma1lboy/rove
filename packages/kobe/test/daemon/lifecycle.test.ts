import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stopDaemonProcess } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type EventedChild = {
  readonly pid?: number
  once(event: "exit", listener: () => void): void
  kill(signal: NodeJS.Signals): boolean
}

/**
 * `stopDaemonProcess` is the shared kill primitive behind `kobe daemon
 * restart` and `kobe reset` (KOB-258). These cover the two paths that are
 * deterministic without a live wedged daemon: nothing running (idempotent
 * cleanup) and a pidfile pointing at an already-dead process. The
 * SIGTERM→SIGKILL escalation is inherited verbatim from the long-proven
 * restart path, so it isn't re-exercised here (it needs a live process
 * that ignores SIGTERM, which is inherently flaky to stage).
 */
describe("stopDaemonProcess", () => {
  let dir: string
  let socketPath: string
  let pidPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kobe-lifecycle-"))
    socketPath = join(dir, "daemon.sock")
    pidPath = join(dir, "daemon.pid")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("reports absent and is a no-op when nothing is running", async () => {
    const result = await stopDaemonProcess(socketPath, pidPath)
    expect(result).toEqual({ pid: null, method: "absent" })
  })

  it("removes a stale socket file even with no pidfile", async () => {
    writeFileSync(socketPath, "") // orphan socket file left by a SIGKILLed daemon
    const result = await stopDaemonProcess(socketPath, pidPath)
    expect(result.method).toBe("absent")
    expect(existsSync(socketPath)).toBe(false)
  })

  it("clears a pidfile that points at a dead process", async () => {
    // Spawn then immediately kill a child to obtain a guaranteed-dead pid
    // (a made-up pid would race a real process in CI). Use node's spawn —
    // vitest runs under Node, where `Bun` is undefined.
    const child = spawn("sleep", ["30"], { stdio: "ignore" }) as unknown as EventedChild
    const deadPid = child.pid as number
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve())
      child.kill("SIGKILL")
    })

    writeFileSync(pidPath, `${deadPid}\n`)
    const result = await stopDaemonProcess(socketPath, pidPath)

    expect(result.pid).toBe(deadPid)
    // The pid was never alive when we checked, so nothing was killed — a
    // stale pidfile is reported as "absent", not "graceful".
    expect(result.method).toBe("absent")
    expect(existsSync(pidPath)).toBe(false)
  })

  it("ignores a non-numeric pidfile", async () => {
    writeFileSync(pidPath, "not-a-pid\n")
    const result = await stopDaemonProcess(socketPath, pidPath)
    expect(result.pid).toBeNull()
    expect(result.method).toBe("absent")
  })

  /**
   * An untrustworthy pidfile is not a pid.
   *
   * `Number("")` is `0`, so a pidfile truncated mid-write parses as `0` —
   * the value `kill` reads as the caller's own process group. Two separate
   * things are pinned here, and only one of them is this file's guard:
   *
   * - `pid: null` is what `readPidFile`'s range check adds. Without it the
   *   result reports pid `0` as the daemon that was found.
   * - `kill` never being called is currently owned by `isProcessAlive`,
   *   which refuses `<= 0` before any signal goes out. The assertion is here
   *   anyway because it is the property that actually matters, and it should
   *   fail if EITHER layer regresses — not only the one below it.
   */
  it.each(["", " ", "0", "-1", "1.5", "abc"])("never signals for a pidfile of %j", async (body) => {
    writeFileSync(pidPath, body)
    const kill = vi.spyOn(process, "kill")
    try {
      const result = await stopDaemonProcess(socketPath, pidPath)
      expect(result).toEqual({ pid: null, method: "absent" })
      expect(kill).not.toHaveBeenCalled()
    } finally {
      kill.mockRestore()
    }
  })

  /**
   * Negative control for the guard above: a real pid still goes through.
   *
   * Without this, a guard that rejected everything would pass every
   * assertion in this file — each daemon would silently read as "absent",
   * and `daemon restart` would leave the old one running and race the new
   * one onto its socket. The child is killed ~100ms in, well inside the 2s
   * before `stopDaemonProcess` escalates, so the graceful path is what gets
   * recorded.
   */
  it("still stops a daemon whose pidfile holds a live pid", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" }) as unknown as EventedChild
    const livePid = child.pid as number
    writeFileSync(pidPath, `${livePid}\n`)

    const kill = vi.spyOn(process, "kill")
    try {
      const stopping = stopDaemonProcess(socketPath, pidPath)
      setTimeout(() => child.kill("SIGKILL"), 100)
      const result = await stopping

      expect(result.pid).toBe(livePid)
      expect(result.method).toBe("graceful")
      // Positive control for the spy in the case above: a real pid DOES
      // reach `process.kill` (the liveness probe at minimum), so "never
      // called" there is a fact about the guards, not about a spy that
      // never fires. Assert before `mockRestore`, which clears the history.
      expect(kill).toHaveBeenCalled()
    } finally {
      kill.mockRestore()
    }
  })
})
