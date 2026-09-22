/**
 * `kobe pty-host` (INTERNAL, spawned by `ensurePtyHostReachable()`): this
 * process becomes the PTY host. Separate from the daemon so `kobe daemon
 * restart` never ends running engine sessions.
 */

import { installDaemonCrashHandlers } from "@sma1lboy/kobe-daemon/daemon/crash-log"
import { rotateLogIfNeeded } from "@sma1lboy/kobe-daemon/daemon/log-rotate"
import { defaultPtyHostLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { formatPtyHostLine } from "@sma1lboy/kobe-daemon/daemon/pty-host-log"
import { startPtyHostServer } from "@sma1lboy/kobe-daemon/daemon/pty-server"
import { CURRENT_VERSION } from "../version.ts"

export async function runPtyHostSubcommand(_argv: readonly string[]): Promise<void> {
  // `pty.log` is our inherited stdout/stderr append fd, so boot is the ONLY safe
  // rotation point — and this longest-lived process rarely reboots.
  rotateLogIfNeeded(defaultPtyHostLogPath())

  // A stray rejection must hit the log, not silently kill every engine session.
  installDaemonCrashHandlers()

  const server = await startPtyHostServer({
    log: (event, message) => console.log(formatPtyHostLine(event, message)),
    // FROZEN build; outlives `daemon restart`. `pty.list` reports it to `rove doctor`.
    version: CURRENT_VERSION,
    // Idle-exit path: the server already closed itself; just end the process.
    onStop: () => process.exit(0),
  })
  console.log(formatPtyHostLine("listen", `v${CURRENT_VERSION} listening on ${server.socketPath}`))

  const shutdown = async (signal: string) => {
    // Log the signal so an outside kill is distinguishable from idle-exit/reset.
    // The freeze store is KEPT: a bare signal is a restart, not `rove reset`.
    console.log(formatPtyHostLine("signal", `${signal} received — closing host, frozen sessions kept`))
    await server.close()
    process.exit(0)
  }
  process.once("SIGINT", () => void shutdown("SIGINT"))
  process.once("SIGTERM", () => void shutdown("SIGTERM"))
}
