/**
 * Daemon-socket bind + ownership hygiene against succession split brain.
 * The client's stop+spawn path unlinks the socket first, so a usurper can
 * bind while the incumbent keeps serving on an unlinked inode. Two rules:
 *
 *  1. A running daemon WATCHES its socket path
 *     ({@link createSocketOwnershipGuard}): file gone or inode changed means
 *     it can never get another connection, so it stops; its clients'
 *     reconnect loops land on the new owner.
 *  2. Shutdown ({@link SocketOwnershipGuard.release}) unlinks socket +
 *     pidfile ONLY on PROVEN ownership (armed, inode matches). A superseded
 *     daemon exiting late must not delete the new owner's files, or each
 *     stale kill triggers another autospawn.
 */

import { readFile, stat, unlink } from "node:fs/promises"
import type { Server } from "node:net"
import { tightenFilePermissions } from "./owner-only.ts"
import { isWindowsPipePath } from "./paths.ts"

/** How often a running daemon re-checks that it still owns its socket path. */
export const DEFAULT_SOCKET_WATCH_MS = 5000

type EventedServer = Server & {
  once(event: "error", listener: (err: Error) => void): void
  removeListener(event: "error", listener: (err: Error) => void): void
}

/**
 * Bind; rejects on the first bind error. chmod 0600 AFTER listen: `listen()`
 * applies the umask, so under 022 any local user could connect. The 0700
 * parent dir covers that too, but the no-peer-credential design leans on the
 * socket being owner-only itself. Windows named pipes have no node to chmod.
 */
export async function listenOnUnixSocket(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const evented = server as EventedServer
    evented.once("error", reject)
    server.listen(socketPath, () => {
      evented.removeListener("error", reject)
      resolve()
    })
  })
  if (!isWindowsPipePath(socketPath)) await tightenFilePermissions(socketPath)
}

/**
 * `kill(pid, 0)`: returns → alive; `ESRCH` → gone; `EPERM` (or any other
 * code) → alive — callers kill or steal locks on this, never on a guess.
 * The pid guard is load-bearing: `kill(0, 0)` hits the caller's OWN process
 * group and succeeds, so pid 0 would report a dead daemon alive.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

/**
 * The pid, or `null` when untrusted (pid <= 1). `Number("")` is `0`, so a
 * torn pidfile reads as "no pidfile" instead of carrying pid 0 onward. The
 * root fix is tmp+rename writes (`writeTextAtomic`).
 */
export async function readPidFile(pidPath: string): Promise<number | null> {
  try {
    const raw = await readFile(pidPath, "utf8")
    const pid = Number(raw.trim())
    return Number.isInteger(pid) && pid > 1 ? pid : null
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
   * FAILS CLOSED: unlink socket + pidfile only on PROVEN ownership (armed,
   * inode matches). Otherwise only UNREF the listener — node and Bun unlink
   * the path BY NAME inside `server.close()`, which would delete the current
   * owner's socket.
   *
   * "Never armed" must NOT clean up unconditionally: a missing pidfile blinds
   * `ensureDaemonReachable`'s busy-daemon grace (keyed on `readPidFile`),
   * sending every client to stop+spawn. Failing closed costs a stale file the
   * boot probe and `stopDaemonProcess` clear; failing open kills a healthy daemon.
   */
  release(server: Server): Promise<void>
}

export function createSocketOwnershipGuard(options: {
  readonly socketPath: string
  readonly pidPath: string
  /** Watch interval in ms; `0` disables the periodic check (release() still verifies). */
  readonly watchMs?: number
  /** Fired once when the socket path is gone or rebound by another process. */
  readonly onLost: () => void
}): SocketOwnershipGuard {
  const watchMs = options.watchMs ?? DEFAULT_SOCKET_WATCH_MS
  let stamp: OwnershipStamp | null = null
  let lost = false
  let timer: ReturnType<typeof setInterval> | null = null

  /** null = path gone; "error" = non-ENOENT stat failure (never a takeover verdict). */
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

  /** Flips `lost` once the path is gone or rebound; never on a transient stat error. */
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
      // Call IMMEDIATELY after listen: any await before this lets a usurper
      // rebind, and we'd stamp (and later delete) THEIR inode. A null stamp
      // means never proven; release() treats it as not-ours.
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
      // Catch a takeover between watch ticks, or with the watch disabled.
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
