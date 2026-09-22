/**
 * PtyHost — daemon-hosted PTY sessions (protocol v4).
 *
 * Owns the raw PTY child (via a `PtyDriver`) plus a capped byte ring per
 * session key, so an engine session outlives the TUI and replays on
 * reattach. VT emulation stays in the TUI; the host only answers the OSC
 * 10/11 color query so headless engines learn default colors. All output
 * bytes enter the ring and cross the socket unchanged.
 *
 * Delivery is TARGETED, not pub/sub: output goes only to a session's
 * attached sinks as `pty.data` frames, which must never be dropped or
 * reordered (a lost chunk corrupts client VT state) — server.ts marks them
 * critical for the ClientWriter.
 *
 * Runs in the standalone `kobe pty-host` process (`pty-server.ts`), not the
 * daemon, so `kobe daemon restart` never touches running sessions. An
 * exited session keeps its scrollback until an explicit `kill` or the
 * task-deletion sweep (`sweepPtyHostSessions` in `client/pty-process.ts`).
 *
 * Freeze/restore (`pty-freeze-store.ts`): metadata and ring persist to disk
 * (throttled while streaming, immediately on exit, fully at shutdown), so
 * host idle-exit, crash, or reboot loses nothing. The next host thaws each
 * session as a dead "restored" corpse; the first `open` respawns it in
 * place from the caller's spec (the TUI passes its engine `--resume` argv).
 * Only `kill`, task deletion, or `rove reset` (wipes the store) forget a
 * session for good.
 */

import { logDaemonError } from "./crash-log.ts"
import type { DaemonFrame, PtyPeekResult } from "./protocol.ts"
import { PtyChildController } from "./pty-child-controller.ts"
import { shouldFreeze } from "./pty-freeze-policy.ts"
import { type FrozenPtySession, freezeSession, thawSession } from "./pty-freeze-store.ts"
import type { PtyAttachResult, PtyHostOptions, PtySessionState, PtySink, PtySpawnSpec } from "./pty-host-types.ts"
import {
  type PtyHostStats,
  type PtySessionInfo,
  describeExit,
  hostStats,
  peekRing,
  ringTail,
  sessionInfo,
} from "./pty-observability.ts"
import { WarmSpare } from "./pty-warm.ts"
import { parseTerminalDefaultColors } from "./terminal-colors.ts"

export type { PtyHostStats, PtySessionInfo } from "./pty-observability.ts"
// Re-exported for the cross-chunk title-boundary tests (pure fold).
export { foldOscTitle } from "./pty-observability.ts"
export type { PtyAttachResult, PtyHostOptions, PtySessionState, PtySink, PtySpawnSpec } from "./pty-host-types.ts"

/** Writes at or above the tty's 1024-byte canonical buffer (the size a
 *  delivery path can silently truncate) get a `daemon.log` line. */
const LOGGED_WRITE_BYTES = 1024

/** Per-session scrollback cap — same order as the web PTY sidecar's 256KB. */
export const DEFAULT_SCROLLBACK_CAP = 512 * 1024
/** Raw ring tail captured into a session's death record. */
const EXIT_TAIL_BYTES = 16 * 1024
/** Freeze cadence policy, re-exported from `pty-freeze-policy.ts`. */
export { FREEZE_INTERVAL_MS, FREEZE_MIN_APPENDED_BYTES, FREEZE_STALE_MS } from "./pty-freeze-policy.ts"

export class PtyHost {
  private readonly sessions = new Map<string, PtySessionState>()
  private readonly opts: PtyHostOptions
  private readonly scrollbackCap: number
  private parkRestoreDeltas = 0
  private parkRestoreFallbacks = 0
  /** Per-child lifecycle; this class owns the set of sessions. */
  private readonly childController: PtyChildController
  /** The one warm-spare shell slot (see `pty-warm.ts`). */
  private readonly warmSpare: WarmSpare

  constructor(opts: PtyHostOptions = {}) {
    this.opts = opts
    this.scrollbackCap = opts.scrollbackCap ?? DEFAULT_SCROLLBACK_CAP
    this.childController = new PtyChildController({
      driver: opts.driver,
      scrollbackCap: this.scrollbackCap,
      onSessionStart: (spare) => {
        if (!spare) this.opts.onSessionStart?.()
      },
      onOutput: (session, data) => {
        if (session.sinks.size === 0) {
          this.maybeFreeze(session)
          return
        }
        const frame: DaemonFrame = {
          type: "event",
          name: "pty.data",
          payload: { key: session.key, data: data.toString("base64") },
        }
        for (const sink of session.sinks.values()) sink(frame)
        this.maybeFreeze(session)
      },
      onExit: (session, exit) => {
        const frame: DaemonFrame = {
          type: "event",
          name: "pty.exit",
          payload: { key: session.key, pid: session.proc?.pid ?? null, ...exit },
        }
        for (const sink of session.sinks.values()) sink(frame)
        this.opts.log?.("pty", `session ${session.key} exited${describeExit(exit)}`)
        // Final freeze: the exit record AND the scrollback as it stood at death
        // must both survive this host's own end (idle-exit, crash).
        this.maybeFreeze(session, true)
        // A CLOSED session did not die. Its child still exits under a signal,
        // which the death record's clean-exit rule can't tell apart, so without
        // this every task delete surfaced as a red engine-death toast.
        if (!session.closedByRequest) {
          try {
            this.opts.onSessionExit?.({
              key: session.key,
              pid: session.proc?.pid ?? null,
              exit,
              tail: ringTail(session.chunks, session.bytes, EXIT_TAIL_BYTES),
            })
          } catch {
            // A death-record hook must never block session teardown.
          }
        }
        this.opts.onSessionEnd?.()
      },
      log: (event, message) => this.opts.log?.(event, message),
    })
    this.warmSpare = new WarmSpare({
      spawn: (key, spec, spare) => this.childController.spawn(key, spec, spare),
      endChild: (session) => this.childController.endChild(session),
      markExited: (session) => this.childController.markExited(session),
      log: (event, message) => this.opts.log?.(event, message),
      onSessionStart: () => this.opts.onSessionStart?.(),
    })
  }

  /**
   * Attach `token`'s connection to the session for `key`, spawning the
   * child on first open (adopting the warm spare when it matches). On
   * reattach the spec is IGNORED — an existing session wins — and the
   * caller gets the ring replay either way.
   */
  open(
    key: string,
    spec: PtySpawnSpec,
    token: object,
    sink: PtySink,
    sinceOffset?: number,
    sincePid?: number,
  ): PtyAttachResult {
    let session = this.sessions.get(key)
    let created = false
    let respawned = false
    if (!session) {
      created = true
      session = this.warmSpare.adopt(key, spec) ?? this.childController.spawn(key, spec)
      this.sessions.set(key, session)
    } else if (!session.alive && session.restored) {
      // A freeze-restored corpse is a host-death casualty, not a death the
      // user saw: respawn in place, scrollback kept.
      this.respawn(session, spec)
      respawned = session.alive
    } else if (
      session.alive &&
      spec.cols !== undefined &&
      spec.rows !== undefined &&
      (session.cols !== spec.cols || session.rows !== spec.rows)
    ) {
      // Last-attach-wins: the SIGWINCH repaints over the stale-size replay.
      // Size-less (headless) opens never resize — shrinking a live session
      // under its attached TUI garbles the pane.
      this.resize(key, spec.cols, spec.rows)
    }
    const defaultColors = parseTerminalDefaultColors(spec.defaultColors)
    if (defaultColors) session.defaultColors = defaultColors
    session.sinks.set(token, sink)
    session.parked = false
    session.parkedScreenBytes = 0
    // Delta replay: when the parked client's offset is still in the ring
    // window AND the child is the incarnation it parked against (`sincePid`),
    // replay only bytes since — serialized screen + delta is bit-identical to
    // never detaching. The pid check lives here because a stale restore must
    // get the full ring, not a delta the client would discard.
    const windowStart = session.totalBytes - session.bytes
    let replay = Buffer.concat(session.chunks)
    let sinceValid = false
    if (
      !created &&
      sinceOffset !== undefined &&
      sinceOffset >= windowStart &&
      sinceOffset <= session.totalBytes &&
      sincePid !== undefined &&
      sincePid === session.proc?.pid
    ) {
      replay = replay.subarray(sinceOffset - windowStart)
      sinceValid = true
    }
    if (sinceOffset !== undefined && sincePid !== undefined) {
      if (sinceValid) this.parkRestoreDeltas++
      else this.parkRestoreFallbacks++
    }
    return {
      replay: replay.toString("base64"),
      alive: session.alive,
      pid: session.proc?.pid ?? null,
      created,
      respawned,
      offset: session.totalBytes,
      sinceValid,
    }
  }

  /** Pre-spawn one idle shell for adoption — policy lives in `pty-warm.ts`. */
  warm(cwd: string, shell?: string, cols = 80, rows = 24): void {
    this.warmSpare.warm(cwd, shell, cols, rows)
  }

  /** Forward client input (already UTF-8 text from xterm) to the child. */
  write(key: string, data: string): void {
    const session = this.sessions.get(key)
    if (!session?.alive || data.length === 0) return
    // Audit trail so a delivered prompt and a lost one are distinguishable
    // after the fact. Large writes only: keystrokes would drown the log.
    if (data.length >= LOGGED_WRITE_BYTES) {
      this.opts.log?.("pty", `wrote ${data.length} bytes to ${key}`)
    }
    try {
      session.proc?.write(data)
    } catch (error) {
      // Not fatal: `proc.exited` is the single source of truth for exit. Logged
      // because the API still reports `delivered: true` for a failed write.
      this.opts.log?.("pty", `write failed on ${key} (${data.length} bytes): ${String(error)}`)
    }
  }

  resize(key: string, cols: number, rows: number): void {
    const session = this.sessions.get(key)
    if (!session?.alive) return
    session.cols = cols
    session.rows = rows
    try {
      session.proc?.resize(cols, rows)
    } catch {
      // See write(): wait for `proc.exited`, not the PTY stream state.
    }
  }

  /**
   * Compare and remove synchronously, so a reopened key cannot inherit an old
   * kill. The child's teardown is async (SIGTERM, up to 500ms grace, then
   * SIGKILL), so the answer is `accepted`, not `killed` — the PTY may still
   * be running when this returns.
   */
  killIfGeneration(
    key: string,
    expectedGeneration: string,
  ): { accepted: true } | { accepted: false; reason: "missing-session" | "generation-mismatch" } {
    const session = this.sessions.get(key)
    if (!session) return { accepted: false, reason: "missing-session" }
    if (session.generation !== expectedGeneration) return { accepted: false, reason: "generation-mismatch" }
    void this.kill(key).catch((err) => logDaemonError("pty-kill", err))
    return { accepted: true }
  }

  /** End the child AND forget the session (explicit close / task deletion). */
  kill(key: string): Promise<void> {
    const session = this.sessions.get(key)
    if (!session) return Promise.resolve()
    this.sessions.delete(key)
    // Drop the freeze record so the next host doesn't resurrect a closed tab;
    // `onExit` reads the flag to skip the death record.
    session.closedByRequest = true
    this.opts.freeze?.drop(key)
    return this.childController.endChild(session)
  }

  /**
   * Re-key a running session (`pty.rename`, the scratch-fold move); the
   * child is untouched. False when the source is missing or the target is
   * taken. The freeze record moves with it; attached sinks keep streaming
   * under the new `session.key`.
   */
  rename(from: string, to: string): boolean {
    const session = this.sessions.get(from)
    if (!session || from === to || this.sessions.has(to)) return false
    this.sessions.delete(from)
    session.key = to
    this.sessions.set(to, session)
    this.opts.freeze?.drop(from)
    this.maybeFreeze(session, true)
    this.opts.log?.("pty", `renamed session ${from} → ${to}`)
    return true
  }

  /** Detach one connection from one session; the child keeps running. */
  detach(key: string, token: object, parked = false, parkedScreenBytes = 0): void {
    const session = this.sessions.get(key)
    if (!session) return
    session.sinks.delete(token)
    // One socket has one sink per key. Only the final detach describes the
    // session's current visibility; a second attached client is still live.
    this.applyParkedOnDetach(session, parked, parkedScreenBytes)
  }

  /** Detach one connection from EVERY session (socket closed). */
  detachClient(token: object): void {
    for (const session of this.sessions.values()) {
      // Only sessions this token held: an already-parked session has no sinks,
      // so an unrelated socket close (`ptyHostHasLiveSessions` polls every
      // 15s) would otherwise wipe every tab's parked bookkeeping.
      if (!session.sinks.delete(token)) continue
      // No explicit park detach, so no client is guaranteed a restorable screen.
      this.applyParkedOnDetach(session)
    }
  }

  /** Update parked state when the last sink just left; a still-attached
   *  session keeps its prior visibility. */
  private applyParkedOnDetach(session: PtySessionState, parked = false, parkedScreenBytes = 0): void {
    if (session.sinks.size !== 0) return
    session.parked = parked
    session.parkedScreenBytes = parked ? Math.max(0, parkedScreenBytes) : 0
  }

  /** Session inventory — lets a fresh TUI discover background sessions. */
  list(): PtySessionInfo[] {
    return Array.from(this.sessions.values(), (s) => sessionInfo(s))
  }

  /** Read-only ring peek (`pty.peek`) — no attach, no spawn, no resize. */
  peek(key: string, sinceOffset?: number): PtyPeekResult {
    return peekRing(this.sessions.get(key), sinceOffset)
  }

  /** Retention facts for diagnostics; no terminal bytes leave the host. */
  stats(): PtyHostStats {
    return hostStats(this.sessions.values(), this.scrollbackCap, this.parkRestoreDeltas, this.parkRestoreFallbacks)
  }

  /** Kill every session and the warm spare before host shutdown completes. */
  async killAll(): Promise<void> {
    const sessions = Array.from(this.sessions.keys(), (key) => this.kill(key))
    sessions.push(this.warmSpare.end())
    await Promise.all(sessions)
  }

  /**
   * Host-process teardown: freeze every session FIRST, then end the
   * children. Unlike killAll this never drops freeze records.
   */
  async shutdown(): Promise<void> {
    this.flushFrozen()
    const endings = Array.from(this.sessions.values(), (session) => this.childController.endChild(session))
    endings.push(this.warmSpare.end())
    await Promise.all(endings)
  }

  /** Persist every session's freeze snapshot now (shutdown path). */
  flushFrozen(): void {
    for (const session of this.sessions.values()) this.maybeFreeze(session, true)
  }

  /**
   * Thaw freeze records at host boot as dead "restored" corpses. Records
   * for keys already present lose (never in practice — restore runs before
   * listen). Returns how many thawed.
   */
  restoreFrozen(records: readonly FrozenPtySession[]): number {
    let restoredCount = 0
    for (const record of records) {
      if (this.sessions.has(record.key)) continue
      const session = thawSession(record, this.scrollbackCap)
      if (!session) continue
      this.sessions.set(record.key, session)
      restoredCount++
    }
    if (restoredCount > 0) this.opts.log?.("pty", `restored ${restoredCount} frozen session(s) from disk`)
    return restoredCount
  }

  /**
   * Respawn a restored corpse in place, keeping the thawed ring. The
   * caller's command wins, else the frozen one. `restored` clears either
   * way so a failed respawn isn't retried on every attach.
   */
  private respawn(session: PtySessionState, spec: PtySpawnSpec): void {
    session.restored = false
    session.exit = null
    if (spec.command && spec.command.length > 0) session.command = [...spec.command]
    session.cols = spec.cols ?? session.cols
    session.rows = spec.rows ?? session.rows
    session.defaultColors = parseTerminalDefaultColors(spec.defaultColors) ?? session.defaultColors
    this.childController.startChild(session)
    if (!session.alive) return
    this.opts.log?.("pty", `respawned restored session ${session.key} (pid ${session.proc?.pid})`)
    this.opts.onSessionStart?.()
  }

  /**
   * Throttled freeze writer (thresholds in `pty-freeze-policy.ts`). `force`
   * writes regardless: an exit record is a change no byte counter sees.
   * Internal `::` keys (the warm spare) never freeze.
   */
  private maybeFreeze(session: PtySessionState, force = false): void {
    const freeze = this.opts.freeze
    if (!freeze || session.key.startsWith("::")) return
    // `kill()` drops the record then awaits `endChild`, so the `onExit` freeze
    // lands a tick later and would recreate it with a fresh `updatedAt` that
    // survives the TTL prune — resurrecting a closed tab. Guarded here so
    // every writer honors it.
    if (session.closedByRequest) return
    const now = Date.now()
    if (!force && !shouldFreeze(session, now)) return
    session.lastFreezeAtMs = now
    session.frozenTotalBytes = session.totalBytes
    freeze.save(freezeSession(session))
  }

  /** Running children; `pty-server.ts` idle-exits at zero. */
  liveCount(): number {
    let n = 0
    for (const session of this.sessions.values()) if (session.alive) n++
    return n
  }
}
