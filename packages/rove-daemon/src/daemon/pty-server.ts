/**
 * Standalone PTY host server — kobe's persistent terminal host.
 *
 * Its own detached process and socket, OUTSIDE the daemon: the daemon
 * restarts routinely, while this tiny process must keep embedded-terminal
 * children alive across TUI exits and daemon restarts. Only `kobe reset`,
 * idle-exit at zero live sessions, or losing its own address (watchdog
 * below) ends it.
 *
 * Wire: the daemon's JSON-lines frame grammar (`protocol.ts`). Every
 * outbound frame is CRITICAL (ordered PTY bytes and RPC responses may not
 * drop); the ring-buffer cap bounds what a session can queue.
 */

import { readFileSync } from "node:fs"
import { mkdir, unlink } from "node:fs/promises"
import { type Server, createServer } from "node:net"
import { dirname } from "node:path"
import { ClientWriter } from "./client-writer.ts"
import { linkLegacyRuntimePath } from "./compat-link.ts"
import { logDaemonError } from "./crash-log.ts"
import { writeTextAtomic } from "./json-file.ts"
import { LineReceiver } from "./line-receiver.ts"
import { ensureOwnerOnlyStateDir } from "./owner-only.ts"
import {
  defaultPtyFreezeDir,
  defaultPtyHostPidPath,
  defaultPtyHostSocketPath,
  isWindowsPipePath,
  legacyPtyHostPidPath,
  legacyPtyHostSocketPath,
  resolveDaemonHomeDir,
} from "./paths.ts"
import { type DaemonFrame, frameToLine } from "./protocol.ts"
import { migrateLegacyPtyHostData } from "./pty-data-migration.ts"
import type { PtyDriver } from "./pty-driver.ts"
import { recordPtyExit } from "./pty-exit-store.ts"
import {
  FREEZE_RESTORE_MAX_BYTES,
  FREEZE_TTL_MS,
  clearFrozenSessions,
  fileFreezeSink,
  loadFrozenSessions,
} from "./pty-freeze-store.ts"
import { PtyHost } from "./pty-host.ts"
import { type PtyClientState, type PtyVerbDeps, dispatchPtyRequest } from "./pty-server-verbs.ts"
import { listenOnUnixSocket } from "./socket-guard.ts"

/**
 * Grace before a zero-live-session host exits; absorbs the boot window before
 * the first `pty.open` and quick close→reopen. Env: `KOBE_PTY_IDLE_EXIT_MS`.
 */
const DEFAULT_IDLE_EXIT_MS = 60_000

/** How often a host re-checks that its own pidfile still names it. */
const DEFAULT_ORPHAN_CHECK_MS = 30_000

/**
 * `KOBE_PTY_MAX_LIFETIME_MS` wall-clock ceiling. Unset in production: a host
 * whose owner is still there must never die for being old. Only fixtures set
 * it — the pidfile watchdog can't see a run interrupted before teardown.
 */
function resolveMaxLifetimeMs(): number | null {
  const raw = process.env.KOBE_PTY_MAX_LIFETIME_MS
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function resolveIdleExitMs(): number {
  const raw = process.env.KOBE_PTY_IDLE_EXIT_MS
  if (raw === undefined) return DEFAULT_IDLE_EXIT_MS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_IDLE_EXIT_MS
}

export interface PtyHostServerOptions {
  readonly socketPath?: string
  readonly pidPath?: string
  /** Grace before a zero-live-session host exits; `0` uses the default. */
  readonly idleExitMs?: number
  /** Cadence of the orphan watchdog (see below); `0` uses the default. */
  readonly orphanCheckMs?: number
  /** Wall-clock life ceiling; `null`/omitted uses `KOBE_PTY_MAX_LIFETIME_MS`,
   *  which is itself normally unset. Only fixtures set either. */
  readonly maxLifetimeMs?: number | null
  /** How PTY children get spawned. Defaults to Bun's; the node host passes node-pty's. */
  readonly driver?: PtyDriver
  /** Freeze-store directory; defaults to the home's `pty-sessions/`. */
  readonly freezeDir?: string
  /** Called after close() when the host stops itself (idle / daemon.stop). */
  readonly onStop?: () => void
  readonly log?: (event: string, message: string) => void
  /** This host's Rove build, echoed by `pty.list` so `rove doctor` can flag a
   *  host serving old code after an upgrade. Absent when unresolvable. */
  readonly version?: string
}

export interface PtyHostServer {
  readonly socketPath: string
  readonly pidPath: string
  close(): Promise<void>
}

export async function startPtyHostServer(options: PtyHostServerOptions = {}): Promise<PtyHostServer> {
  // Before ANY host-owned path resolves: this is the single-writer moment for
  // the exit + freeze stores, so it is where they leave the legacy layout.
  migrateLegacyPtyHostData()
  const socketPath = options.socketPath ?? defaultPtyHostSocketPath()
  const pidPath = options.pidPath ?? defaultPtyHostPidPath()
  const freezeDir = options.freezeDir ?? defaultPtyFreezeDir()
  const idleExitMs = options.idleExitMs || resolveIdleExitMs()
  const orphanCheckMs = options.orphanCheckMs || DEFAULT_ORPHAN_CHECK_MS
  const maxLifetimeMs = options.maxLifetimeMs ?? resolveMaxLifetimeMs()
  const bootedAtMs = Date.now()
  const log = options.log ?? (() => {})
  const clients = new Set<PtyClientState>()
  let stopping = false
  /** Set by `daemon.stop` (rove reset): wipe the freeze store so the next host
   *  starts EMPTY. Idle-exit, SIGTERM, and crashes keep it. */
  let wipeFreezeOnStop = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const cancelIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }
  // NOT unref'd: being the only pending work is exactly the state it resolves.
  const armIdle = (): void => {
    if (stopping) return
    cancelIdle()
    idleTimer = setTimeout(() => {
      if (stopping || ptys.liveCount() > 0) return
      log("idle", `no live sessions for ${idleExitMs}ms — exiting`)
      void stop()
    }, idleExitMs)
  }

  /**
   * Orphan watchdog — the ONLY keep-alive that survives losing every client.
   *
   * A live session keeps this host up indefinitely (and the daemon's
   * `PtyLiveHold` chains off that), so a host whose home was deleted under it
   * would keep idle shells alive with no address left to reach it (observed:
   * 25 hosts stranded for up to two days after harness homes were rm'd).
   *
   * The signal is possession of our own ADDRESS, not age or client count:
   * the pidfile must still say `process.pid`.
   *  - pidfile gone      → whatever owned this home tore it down (or deleted
   *                        the home outright) while we kept running.
   *  - pidfile is a peer → a second host bound our path and owns it now; we
   *                        are the stranded one.
   *  - pidfile is us     → still reachable. A daemon restart never touches
   *                        it, so `rove daemon restart` never lands here.
   *
   * Self-termination only: nothing here reads the process table or signals
   * another pid, so it cannot reach another home's host.
   */
  const orphaned = (): string | null => {
    if (maxLifetimeMs !== null && Date.now() - bootedAtMs >= maxLifetimeMs) {
      return `exceeded its ${maxLifetimeMs}ms lifetime ceiling`
    }
    let owner: string
    try {
      owner = readFileSync(pidPath, "utf8").trim()
    } catch {
      return `pidfile ${pidPath} is gone`
    }
    const pid = Number.parseInt(owner, 10)
    if (pid === process.pid) return null
    return Number.isInteger(pid) ? `pidfile ${pidPath} now names pid ${pid}` : `pidfile ${pidPath} is unreadable`
  }

  // unref'd, unlike the idle timer: never the reason the loop stays alive.
  const orphanTimer = setInterval(() => {
    if (stopping) return
    const reason = orphaned()
    if (!reason) return
    log("orphan", `${reason} — exiting rather than outliving my owner`)
    void stop()
  }, orphanCheckMs)
  orphanTimer.unref?.()

  const ptys = new PtyHost({
    onSessionStart: cancelIdle,
    onSessionEnd: () => {
      if (ptys.liveCount() === 0) armIdle()
    },
    // Durable death record — must survive this host's own idle-exit.
    onSessionExit: (info) => {
      try {
        recordPtyExit(info)
      } catch (err) {
        log("pty", `exit record write failed for ${info.key}: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    // Per-session snapshots survive a host restart. Restore runs BEFORE
    // listen, so no client open can race the thaw.
    freeze: fileFreezeSink(freezeDir),
    driver: options.driver,
    log,
  })
  ptys.restoreFrozen(
    loadFrozenSessions(freezeDir, Date.now(), (s) => {
      // Log deferred/expired counts: a partial restore or a TTL deletion is
      // otherwise invisible to the user.
      const mib = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))}MB`
      const notes = [`restored ${s.restored} (${mib(s.bytesRead)})`]
      if (s.deferred > 0) notes.push(`${s.deferred} left unread past the ${mib(FREEZE_RESTORE_MAX_BYTES)} budget`)
      if (s.expired > 0) notes.push(`${s.expired} deleted past the ${FREEZE_TTL_MS / 86_400_000}-day TTL`)
      if (s.unreadable > 0) notes.push(`${s.unreadable} unreadable`)
      log("freeze", notes.join(", "))
    }),
  )

  // A Windows named pipe has no parent directory to create.
  const pipeSocket = isWindowsPipePath(socketPath)
  // 0700 every boot: this host spawns shells for whoever reaches its socket,
  // so the directory mode is the gate.
  await ensureOwnerOnlyStateDir(resolveDaemonHomeDir())
  if (!pipeSocket) await mkdir(dirname(socketPath), { recursive: true })
  await mkdir(dirname(pidPath), { recursive: true })
  // Never unlink before listen: a second host could bind the same path,
  // overwrite the pidfile, and strand the first host's live sessions.
  // `ensurePtyHostReachable()` clears only a confirmed-stale socket.

  const server: Server = createServer((socket) => {
    const client: PtyClientState = {
      socket,
      writer: new ClientWriter(socket, {
        onOverflow: () => {
          log("backpressure", "disconnecting PTY client whose critical queue exceeded 8MiB")
          socket.destroy()
        },
      }),
    }
    clients.add(client)
    const receiver = new LineReceiver()
    socket.on("data", (chunk: Buffer) => {
      if (!receiver.push(chunk, (line) => handleLine(client, line))) {
        log("framing", "disconnecting PTY client whose request exceeded 8MiB")
        socket.destroy()
      }
    })
    socket.on("error", () => {})
    socket.on("close", () => {
      clients.delete(client)
      // Children keep running — only this connection's fan-out stops.
      ptys.detachClient(client)
    })
  })

  const api: PtyHostServer = {
    socketPath,
    pidPath,
    async close() {
      if (stopping) return
      stopping = true
      cancelIdle()
      clearInterval(orphanTimer)
      // Ending the host ends its sessions; shutdown() freezes them first.
      await ptys.shutdown()
      if (wipeFreezeOnStop) clearFrozenSessions(freezeDir)
      for (const client of Array.from(clients)) client.socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      // Only a filesystem socket leaves a node behind; a named pipe doesn't.
      if (!pipeSocket) await unlink(socketPath).catch(() => {})
      await unlink(pidPath).catch(() => {})
    },
  }

  async function stop(): Promise<void> {
    await api.close().catch((err) => logDaemonError("pty-host-shutdown", err))
    options.onStop?.()
  }

  const verbDeps: PtyVerbDeps = {
    ptys,
    writeFrame,
    requestStop: () => {
      wipeFreezeOnStop = true
      setTimeout(() => void stop(), 0).unref()
    },
    ...(options.version ? { version: options.version } : {}),
  }

  function handleLine(client: PtyClientState, line: string): void {
    if (line.trim().length > 0) {
      let frame: DaemonFrame | null = null
      try {
        frame = JSON.parse(line) as DaemonFrame
      } catch {
        writeFrame(client, { type: "response", id: "parse-error", error: { message: "malformed frame" } })
      }
      if (frame) {
        if (frame.type !== "request") {
          writeFrame(client, { type: "response", id: "parse-error", error: { message: "requests only" } })
        } else {
          const req = frame
          const reply = (payload: unknown): void =>
            writeFrame(client, { type: "response", id: req.id, name: req.name, payload })
          const fail = (err: unknown): void =>
            writeFrame(client, {
              type: "response",
              id: req.id,
              name: req.name,
              error: { message: err instanceof Error ? err.message : String(err) },
            })
          try {
            const payload = dispatchPtyRequest(req, client, verbDeps)
            // Only a waiting `pty.kill` returns a promise; written as-is it
            // would serialise to `{}`.
            if (payload instanceof Promise) payload.then(reply, fail)
            else reply(payload)
          } catch (err) {
            fail(err)
          }
        }
      }
    }
  }

  // Post-listen chmod: `listen()` applies the umask, leaving the node world-connectable.
  await listenOnUnixSocket(server, socketPath)
  // tmp+rename: a torn pidfile is EMPTY, and empty parses as pid 0.
  await writeTextAtomic(pidPath, `${process.pid}\n`)
  // A pre-rename TUI that can't see this host starts a SECOND one, splitting engine tabs.
  if (!pipeSocket) {
    const home = resolveDaemonHomeDir()
    await linkLegacyRuntimePath(socketPath, legacyPtyHostSocketPath(home))
    await linkLegacyRuntimePath(pidPath, legacyPtyHostPidPath(home))
  }
  armIdle()
  log("boot", `pty host listening on ${socketPath}`)
  return api
}

function writeFrame(client: Pick<PtyClientState, "writer">, frame: DaemonFrame): void {
  // Everything here is critical: dropping a response or PTY frame corrupts the client.
  client.writer.write(frameToLine(frame))
}
