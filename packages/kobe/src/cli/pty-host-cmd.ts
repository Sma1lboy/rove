/**
 * `kobe pty-host` — run the standalone PTY host server in the foreground
 * (this process becomes it). INTERNAL: spawned detached by
 * `ensurePtyHostReachable()` when the terminal pane needs a host; not
 * listed in `kobe --help`. See `kobe-daemon/daemon/pty-server.ts` for
 * why this is a separate process from the daemon: `kobe daemon restart`
 * must never end running engine sessions.
 */

import { installDaemonCrashHandlers } from "@sma1lboy/kobe-daemon/daemon/crash-log"
import { rotateLogIfNeeded } from "@sma1lboy/kobe-daemon/daemon/log-rotate"
import { defaultPtyHostLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { startPtyHostServer } from "@sma1lboy/kobe-daemon/daemon/pty-server"

export async function runPtyHostSubcommand(_argv: readonly string[]): Promise<void> {
  // `pty.log` is stdout/stderr inherited from the parent's
  // `spawnDetachedDaemon` append fd, so boot is the ONLY safe rotation point
  // — same reasoning as `daemon-cmd.ts`. It also matters MORE here:
  // the pty host is the longest-lived process in the system (it survives
  // `rove daemon restart` by design), so it is the least likely to ever be
  // restarted and have its log cleaned up. Issue #26 grew client.log to
  // 736MB; this log was the third one and was left uncapped.
  rotateLogIfNeeded(defaultPtyHostLogPath())

  // Crash net first: a stray rejection must land in the log, not silently
  // kill the process that owns every background engine session.
  installDaemonCrashHandlers()

  const server = await startPtyHostServer({
    log: (event, message) => console.log(`[pty-host ${event}] ${message}`),
    // Idle-exit path: the server already closed itself; just end the process.
    onStop: () => process.exit(0),
  })
  console.log(`rove pty-host: listening on ${server.socketPath}`)

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.once("SIGINT", () => void shutdown())
  process.once("SIGTERM", () => void shutdown())
}
