/**
 * `kobe pty-host` boot (`runPtyHostSubcommand`).
 *
 * The one thing pinned here is log rotation. `pty.log` is stdout/stderr
 * inherited as an append fd from the parent's `spawnDetachedDaemon`, so boot
 * is the only point at which it can safely be rotated — and it is the
 * easiest of the three logs to leave uncapped. The PTY host is also the
 * longest-lived process in the
 * system by design, so it is the least likely to ever restart and clean up
 * after itself.
 *
 * Real filesystem against a ROVE_HOME_DIR tempdir; only the server itself is
 * mocked, so the path resolution the rotation depends on stays real.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultPtyHostLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CURRENT_VERSION } from "../../src/version.ts"

const mocks = vi.hoisted(() => ({
  startPtyHostServer: vi.fn(),
  installDaemonCrashHandlers: vi.fn(),
}))

vi.mock("@sma1lboy/kobe-daemon/daemon/pty-server", () => ({
  startPtyHostServer: mocks.startPtyHostServer,
}))

vi.mock("@sma1lboy/kobe-daemon/daemon/crash-log", () => ({
  installDaemonCrashHandlers: mocks.installDaemonCrashHandlers,
}))

let home: string
let logPath: string
const prevHome = process.env.ROVE_HOME_DIR

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kobe-pty-host-cmd-"))
  process.env.ROVE_HOME_DIR = home
  logPath = defaultPtyHostLogPath(home)
  mkdirSync(join(logPath, ".."), { recursive: true })
  mocks.startPtyHostServer.mockReset().mockResolvedValue({ socketPath: join(home, "pty.sock"), close: async () => {} })
  mocks.installDaemonCrashHandlers.mockReset()
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  // boot() registers real SIGINT/SIGTERM handlers on this process; leaving
  // them stacked would have the runner's own signals call process.exit(0).
  process.removeAllListeners("SIGINT")
  process.removeAllListeners("SIGTERM")
  // Assigning undefined would set the literal string "undefined"; the var has
  // to actually go away or every later test file inherits a bogus home.
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
  rmSync(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function boot(): Promise<void> {
  const { runPtyHostSubcommand } = await import("../../src/cli/pty-host-cmd.ts")
  await runPtyHostSubcommand([])
}

describe("pty-host log lines and version reporting", () => {
  it("timestamps every host log line, the way daemon.log does", async () => {
    // Bare `[pty-host <event>] …` lines cannot be correlated against
    // daemon.log at all: two readers of the same incident placed the same
    // session death nine minutes apart because pty.log carried no time.
    const logged = vi.spyOn(console, "log").mockImplementation(() => {})
    await boot()

    const emit = mocks.startPtyHostServer.mock.calls[0]?.[0]?.log as (event: string, message: string) => void
    emit("freeze", "wrote 3 sessions")
    const lines = logged.mock.calls.map((call) => String(call[0]))
    expect(
      lines.some((line) => /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] pty-host \[freeze\]: wrote 3 sessions$/.test(line)),
    ).toBe(true)
    // The host's own boot line is subject to the same rule.
    expect(lines.some((line) => /^\[\d{4}-.+Z\] pty-host \[listen\]: /.test(line))).toBe(true)
  })

  it("reports the build it booted with, so doctor can catch a host older than the CLI", async () => {
    await boot()
    expect(mocks.startPtyHostServer.mock.calls[0]?.[0]?.version).toBe(CURRENT_VERSION)
  })
})

describe("pty-host boot rotates pty.log", () => {
  it("rotates an over-cap log to .old before the host writes a byte", async () => {
    writeFileSync(logPath, "x".repeat(11 * 1024 * 1024), "utf8")

    await boot()

    expect(existsSync(`${logPath}.old`)).toBe(true)
    expect(readFileSync(`${logPath}.old`, "utf8").length).toBe(11 * 1024 * 1024)
    // Rotation is a rename: the live path is free for the inherited fd.
    expect(existsSync(logPath)).toBe(false)
    expect(mocks.startPtyHostServer).toHaveBeenCalledOnce()
  })

  it("leaves an under-cap log alone", async () => {
    writeFileSync(logPath, "small", "utf8")

    await boot()

    expect(existsSync(`${logPath}.old`)).toBe(false)
    expect(readFileSync(logPath, "utf8")).toBe("small")
  })

  it("starts fine with no log yet", async () => {
    await boot()
    expect(mocks.startPtyHostServer).toHaveBeenCalledOnce()
  })
})
