/**
 * Daemon-socket bind + ownership hygiene (issue #10 — the 2026-08-10/11
 * daemon-succession split brain).
 *
 * The boot-time live-owner probe (49dfec845) refuses to REPLACE a healthy
 * daemon, but it cannot help once the path has already been clobbered: the
 * client-side stop+spawn path unlinks the socket before spawning, so a
 * usurper's boot probe sees "absent" and binds — leaving the incumbent
 * serving its attached TUI on an unlinked inode, invisible to every new
 * connection. Two rules here close that hole:
 *
 *  1. A running daemon WATCHES its own socket path
 *     ({@link createSocketOwnershipGuard}): if the file vanishes or its
 *     inode changes, another daemon took the path. This daemon can never
 *     receive another connection, so it stops itself; its attached
 *     clients' reconnect loops then land on the new owner. A socketless
 *     daemon must never outlive its socket.
 *  2. Shutdown cleanup ({@link SocketOwnershipGuard.release}) unlinks the
 *     socket + pidfile ONLY on PROVEN ownership — armed, and the inode
 *     still matches. Unproven (superseded, or never armed) means hands off.
 *     A superseded daemon exiting late must not delete the NEW owner's
 *     files — that was the whack-a-mole cascade where killing each stale
 *     daemon unlinked the live one's socket and triggered yet another
 *     autospawn.
 */

import { readFile, stat, unlink } from "node:fs/promises"
import type { Server } from "node:net"

/** How often a running daemon re-checks that it still owns its socket path. */
export const DEFAULT_SOCKET_WATCH_MS = 5000

type EventedServer = Server & {
  once(event: "error", listener: (err: Error) => void): void
  removeListener(event: "error", listener: (err: Error) => void): void
}

/** Bind `server` to `socketPath`; resolves once listening, rejects on the
 *  first bind error (EADDRINUSE, path too long, …). */
export function listenOnUnixSocket(server: Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const evented = server as EventedServer
    evented.once("error", reject)
    server.listen(socketPath, () => {
      evented.removeListener("error", reject)
      resolve()
    })
  })
}

export async function readPidFile(pidPath: string): Promise<number | null> {
  try {
    const raw = await readFile(pidPath, "utf8")
    const pid = Number(raw.trim())
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

/** The bound socket's filesystem identity, recorded at arm() time. */
interface OwnershipStamp {
  readonly dev: number
  readonly ino: number
}

export interface SocketOwnershipGuard {
  /** Fingerprint the just-bound socket and start the ownership watch.
   *  Call once, right after listen + pidfile write. */
  arm(): Promise<void>
  /**
   * Ownership-aware teardown, and it FAILS CLOSED. Unlink socket + pidfile
   * only while ownership is PROVEN — the guard armed, and the path still
   * carries the inode it stamped. Otherwise (superseded, or never armed at
   * all) only UNREF the listener: both node and Bun unlink the socket path
   * BY NAME inside `server.close()`, so closing gracefully would delete
   * whoever owns the path now. The unref'd listener sits on an unlinked
   * inode, can never accept another connection, and dies with the process.
   *
   * "Never armed" used to fall back to unconditional cleanup, which is how
   * the cascade came back (2026-09-01, 293 autospawns / 23 takeovers in one
   * window): a daemon that lost the path between bind and arm deleted the
   * live owner's socket AND pidfile. The missing pidfile then blinded
   * `ensureDaemonReachable`'s busy-daemon grace, which keys on
   * `readPidFile` — so every client skipped the grace and went straight to
   * stop+spawn, feeding the loop. The cost of failing closed is a stale
   * socket/pidfile, which the boot probe and `stopDaemonProcess` already
   * clear; the cost of failing open is killing a healthy daemon.
   */
  release(server: Server): Promise<void>
}

export function createSocketOwnershipGuard(options: {
  readonly socketPath: string
  readonly pidPath: string
  /** Watch interval in ms; `0` disables the periodic check (release() still
   *  verifies ownership). Defaults to {@link DEFAULT_SOCKET_WATCH_MS}. */
  readonly watchMs?: number
  /** Fired once when the socket path is observed gone or rebound by another
   *  process. Callee decides how to stop (server.ts routes to stopSoon). */
  readonly onLost: () => void
}): SocketOwnershipGuard {
  const watchMs = options.watchMs ?? DEFAULT_SOCKET_WATCH_MS
  let stamp: OwnershipStamp | null = null
  let lost = false
  let timer: ReturnType<typeof setInterval> | null = null

  /** null = path gone; "error" = stat failed for a non-ENOENT reason (never
   *  a takeover verdict on a maybe — the watch skips, release() falls back). */
  const currentStamp = async (): Promise<OwnershipStamp | null | "error"> => {
    try {
      const s = await stat(options.socketPath)
      return { dev: s.dev, ino: s.ino }
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ENOENT" ? null : "error"
    }
  }

  const stopTimer = (): void => {
    if (timer) clearInterval(timer)
    timer = null
  }

  /** Re-read the path; flips `lost` once it is gone or rebound. Never flips
   *  on a transient stat error — a takeover verdict is not made on a maybe. */
  const verify = async (): Promise<void> => {
    if (stamp === null || lost) return
    const now = await currentStamp()
    if (now === "error") return
    if (now === null || now.dev !== stamp.dev || now.ino !== stamp.ino) lost = true
  }

  const check = async (): Promise<void> => {
    if (stamp === null || lost) return
    await verify()
    if (!lost) return
    stopTimer()
    options.onLost()
  }

  return {
    async arm() {
      // Call this IMMEDIATELY after listen: every await between bind and
      // fingerprint is a window in which the path can be unlinked (stamp
      // stays null) or rebound by a usurper (we would stamp THEIR inode and
      // later delete their socket). A null stamp means ownership was never
      // proven, and release() treats that as not-ours.
      const now = await currentStamp()
      if (now === null || now === "error") return
      stamp = now
      if (watchMs > 0) {
        timer = setInterval(() => void check(), watchMs)
        timer.unref?.()
      }
    },
    async release(server: Server) {
      stopTimer()
      // Final ownership read — a takeover between watch ticks (or with the
      // watch disabled) must still be honored here.
      await verify()
      if (stamp === null || lost) {
        server.unref()
        return
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await unlink(options.socketPath).catch(() => {})
      await unlink(options.pidPath).catch(() => {})
    },
  }
}
