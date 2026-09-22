/**
 * Daemon-stop primitive shared by `kobe daemon restart` and `kobe reset`: the
 * daemon must actually be gone before they continue. A wedged daemon would
 * outlive a `daemon.stop` RPC, and a respawn onto its socket races EADDRINUSE
 * (or two daemons write one `tasks.json`), so we poll the pid with `kill -0`
 * and escalate graceful → SIGTERM → SIGKILL.
 */

import { unlink } from "node:fs/promises"
import { KobeDaemonClient } from "../client/index.ts"
import type { DaemonStopReason } from "./protocol.ts"
import { isProcessAlive, readPidFile } from "./socket-guard.ts"

/**
 * The strongest signal {@link stopDaemonProcess} needed. `"absent"`: no live
 * daemon (no pidfile, or a stale one), only stale files cleared. `"graceful"`:
 * the RPC sufficed.
 */
export type DaemonStopMethod = "absent" | "graceful" | "sigterm" | "sigkill"

export interface StopDaemonResult {
  /** The pid read from the pidfile, or `null` if there was no pidfile. */
  pid: number | null
  /** The strongest signal needed; `"absent"` means nothing live was running. */
  method: DaemonStopMethod
}

/** The only honest liveness answer: a busy healthy daemon can fail a socket
 *  probe. Kill decisions must ask the OS, not the socket. */
export { isProcessAlive }

/**
 * Stop the daemon on `socketPath`, wait until its process is gone, then remove
 * socket + pidfile. Idempotent; never respawns. `reason` rides
 * `daemon.stopping` to attached clients (`"restart"` tells a TUI its code is
 * being replaced); only the graceful RPC carries it.
 */
export async function stopDaemonProcess(
  socketPath: string,
  pidPath: string,
  opts: { readonly reason?: DaemonStopReason } = {},
): Promise<StopDaemonResult> {
  const oldPid = await readPidFile(pidPath)
  // Decide before the RPC, so a stale pidfile reports "absent", not "graceful".
  const targetPid = oldPid !== null && oldPid !== process.pid ? oldPid : null
  const wasAlive = targetPid !== null && isProcessAlive(targetPid)
  let method: DaemonStopMethod = wasAlive ? "graceful" : "absent"

  // 2s for the RPC, then signals. Nothing listening → connect fails fast.
  const client = new KobeDaemonClient(socketPath)
  const stopRequest = client.request("daemon.stop", { reason: opts.reason ?? "stop" }).catch(() => undefined)
  const stopTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2000))
  await Promise.race([stopRequest, stopTimeout])
  client.close()

  // `kill -0` throws ESRCH once the process exits.
  if (wasAlive && targetPid !== null) {
    const deadline = Date.now() + 5000
    let escalated = false
    while (Date.now() < deadline) {
      try {
        process.kill(targetPid, 0)
      } catch {
        break
      }
      // After 2s, SIGTERM: covers a daemon wedged in its own shutdown.
      if (!escalated && Date.now() - (deadline - 5000) > 2000) {
        try {
          process.kill(targetPid, "SIGTERM")
        } catch {
          // Already gone — next iteration sees ESRCH and breaks.
        }
        method = "sigterm"
        escalated = true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    // Still alive after the budget → SIGKILL.
    try {
      process.kill(targetPid, 0)
      process.kill(targetPid, "SIGKILL")
      method = "sigkill"
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch {
      // Already gone — happy path.
    }
  }

  // A SIGKILLed daemon leaves both files behind (EADDRINUSE on respawn).
  // Re-read first: a pidfile written after our read may name a live owner,
  // and unlinking its files strands it unreachable and unstoppable (seen: 25
  // stranded PTY hosts, up to two days old). A live owner keeps its files.
  const survivor = await readPidFile(pidPath)
  if (survivor !== null && survivor !== process.pid && isProcessAlive(survivor)) {
    return { pid: oldPid, method }
  }
  await unlink(socketPath).catch(() => {})
  await unlink(pidPath).catch(() => {})
  return { pid: oldPid, method }
}
