/**
 * PtyHost — daemon-hosted PTY sessions (protocol v4).
 *
 * Persistent out-of-process terminals for embedded engine sessions: the
 * daemon owns the raw PTY child (spawned through a `PtyDriver`) plus a
 * capped byte ring buffer per session key, so an engine session keeps
 * running when the TUI exits and replays its screen when a TUI reattaches.
 * VT emulation stays in the TUI (xterm-headless). The host recognizes only
 * the narrow OSC 10/11 capability query so detached/headless engines can
 * learn the same default colors; all output bytes still enter the ring and
 * cross the socket unchanged.
 *
 * Delivery model: TARGETED, not pub/sub. Each session tracks the
 * connections attached to it; output goes only to those sinks as
 * `pty.data` event frames. PTY frames must never be dropped or reordered
 * (a lost chunk corrupts the client's VT state) — server.ts marks them
 * critical for the ClientWriter.
 *
 * Lifecycle: hosted by the standalone `kobe pty-host` process
 * (`pty-server.ts`), NOT the daemon — so `kobe daemon restart` (routine
 * after code changes) never touches running sessions, exactly like a
 * persistent terminal server outliving the TUI. An exited session is kept,
 * scrollback intact, so a reattach can still show how the child died; it is
 * removed by an explicit `kill` or the daemon's task-deletion sweep
 * (`sweepPtyHostSessions` in `client/pty-process.ts`).
 *
 * Freeze/restore (`pty-freeze-store.ts`): every session's metadata and
 * ring persist to disk (throttled while streaming, immediately on exit,
 * fully at shutdown), so the host PROCESS ending — idle-exit, crash, a
 * machine reboot — does not take the work scene with it. The next host
 * thaws each session as a dead "restored" corpse with its scrollback, and
 * the first `open` respawns the child in place using the caller's launch
 * spec (the TUI's dead-reattach passes its engine `--resume` argv). Only
 * an explicit `kill`, task deletion, or `rove reset` (which wipes the
 * store) forgets a session for good.
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

/** Writes at or above this size get a `daemon.log` line. Above the tty's
 *  1024-byte canonical buffer, so anything big enough to be silently
 *  truncated by a delivery path is recorded. */
const LOGGED_WRITE_BYTES = 1024

/** Per-session scrollback cap — same order as the web PTY sidecar's 256KB. */
export const DEFAULT_SCROLLBACK_CAP = 512 * 1024
/** Raw ring tail captured into a session's death record. */
const EXIT_TAIL_BYTES = 16 * 1024
/** Default grace after a human keystroke before headless delivery is allowed. */
const DEFAULT_HUMAN_WRITE_QUIET_MS = 10_000

function resolveHumanWriteQuietMs(): number {
  const raw = process.env.KOBE_PTY_HUMAN_WRITE_QUIET_MS
  if (raw === undefined) return DEFAULT_HUMAN_WRITE_QUIET_MS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HUMAN_WRITE_QUIET_MS
}

/** Freeze cadence policy (`pty-freeze-policy.ts`) — re-exported because the
 *  host is where callers look for it. */
export { FREEZE_INTERVAL_MS, FREEZE_MIN_APPENDED_BYTES, FREEZE_STALE_MS } from "./pty-freeze-policy.ts"

export class PtyHost {
  private readonly sessions = new Map<string, PtySessionState>()
  private readonly opts: PtyHostOptions
  private readonly scrollbackCap: number
  private readonly humanWriteQuietMs: number
  private parkRestoreDeltas = 0
  private parkRestoreFallbacks = 0
  /** One session's child-process lifecycle — `pty-child-controller.ts` owns a
   *  SINGLE child; this class owns the set of them. */
  private readonly childController: PtyChildController
  /** The one warm-spare shell slot (see `pty-warm.ts`). */
  private readonly warmSpare: WarmSpare

  constructor(opts: PtyHostOptions = {}) {
    this.opts = opts
    this.scrollbackCap = opts.scrollbackCap ?? DEFAULT_SCROLLBACK_CAP
    this.humanWriteQuietMs = opts.humanWriteQuietMs ?? resolveHumanWriteQuietMs()
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
        // A session someone CLOSED did not die. The child still exits under a
        // signal, so the death record's clean-exit noise rule cannot tell the
        // two apart, and a requested close was reaching the UI as an engine
        // death: deleting a task killed its engine, `pty-exit-watch` replayed
        // that as `dead`, and `attentionKindFor` turned it into a red toast on
        // every single successful delete.
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
   * reattach the spawn spec is IGNORED (the session already runs); the
   * caller gets the ring-buffer replay either way. A fresh TUI can
   * therefore always pass its would-be spawn command — an existing
   * background session simply wins.
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
      // user saw: respawn it in place (scrollback kept) instead of handing
      // back a post-mortem. The caller's spec wins when it carries a
      // command — the TUI's dead-reattach passes its engine-resume launch.
      this.respawn(session, spec)
      respawned = session.alive
    } else if (
      session.alive &&
      spec.cols !== undefined &&
      spec.rows !== undefined &&
      (session.cols !== spec.cols || session.rows !== spec.rows)
    ) {
      // Reattach from a differently-sized client: last-attach-wins — the
      // SIGWINCH makes a full-screen app repaint at the new size, fixing
      // what the stale-size replay painted. Size-less opens
      // (headless delivery/ensure clients) never resize: shrinking a live
      // session out from under its attached TUI garbles the pane.
      this.resize(key, spec.cols, spec.rows)
    }
    const defaultColors = parseTerminalDefaultColors(spec.defaultColors)
    if (defaultColors) session.defaultColors = defaultColors
    session.sinks.set(token, sink)
    session.parked = false
    session.parkedScreenBytes = 0
    // Delta replay: a parking client recorded the monotonic offset it had
    // consumed; when that offset is still inside the ring window AND the
    // child is the same incarnation it parked against (`sincePid`), replay
    // ONLY the bytes written since — its serialized screen + this delta is
    // bit-identical to never detaching. The pid check lives HERE because
    // the client can't validate before the slice: a stale restore must get
    // the full ring, not a delta it will discard. Trimmed-away offsets and
    // respawned keys fall back the same way.
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

  /** Forward client input (already UTF-8 text from xterm) to the child.
   *  `client` identifies the connection; writes from attached sinks are
   *  recorded as human typing for the delivery gate. */
  write(key: string, data: string, client?: object): void {
    const session = this.sessions.get(key)
    if (!session?.alive || data.length === 0) return
    if (client !== undefined && session.sinks.has(client)) {
      session.lastHumanWriteMs = Date.now()
    }
    // Audit trail for prompt delivery. `daemon.log` recorded activity only
    // once the daemon OBSERVED engine output, so there was no record of a
    // prompt having been written at all — which made a delivered prompt and
    // a lost one indistinguishable after the fact. Only large writes are
    // logged: keystrokes would drown the log, and size is what the
    // truncation bug turned on.
    if (data.length >= LOGGED_WRITE_BYTES) {
      this.opts.log?.("pty", `wrote ${data.length} bytes to ${key}`)
    }
    try {
      session.proc?.write(data)
    } catch (error) {
      // Still not fatal — a terminal stream error is not proof the subprocess
      // exited, and `proc.exited` remains the single source of truth for that.
      // But swallowing it SILENTLY made a failed write indistinguishable from
      // a successful one all the way up to the API's `delivered: true`, so it
      // gets a log line even though it does not change control flow.
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
   * kill. The CHILD's teardown is asynchronous (SIGTERM, up to 500ms grace,
   * then SIGKILL), so the answer is `accepted`, not `killed`: the compare-and-
   * remove is what this call actually completed. It said `killed: true` before
   * the signal had been sent, which is how `rove api tab-close` reported a
   * successful close over a PTY that was still running.
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
    // An explicit close is not a restart casualty — drop the freeze record
    // so the next host incarnation does not resurrect what was closed. Nor is
    // it a death: `onExit` reads this flag to skip the death record.
    session.closedByRequest = true
    this.opts.freeze?.drop(key)
    return this.childController.endChild(session)
  }

  /**
   * Re-key a running session (`pty.rename`) — the scratch-fold move: the
   * shell keeps running untouched, only its ownership label changes, so
   * task-deletion sweeps and every future attach see it under the adopting
   * task. No-ops (false) when the source is missing or the target key is
   * taken — the caller must pick a free tab id first. The source key's
   * freeze record moves with it; attached sinks keep streaming (frames
   * carry `session.key`, which is the new one from here on).
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
      // Only sessions this token actually held. `applyParkedOnDetach` passes
      // its `sinks.size !== 0` guard for any ALREADY-parked session (a parked
      // TUI is no longer a sink), so running it unconditionally let one
      // unrelated socket close — `ptyHostHasLiveSessions` polls every 15s —
      // wipe the parked bookkeeping of every tab in the host.
      if (!session.sinks.delete(token)) continue
      // A socket vanished without an explicit park detach, so no local
      // registry is guaranteed to retain a restorable screen.
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
    return peekRing(this.sessions.get(key), sinceOffset, this.humanWriteQuietMs)
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
   * Host-process teardown (the server's close()): freeze every session
   * FIRST so the next host incarnation can restore it, then end the live
   * children. Unlike killAll this never DROPS freeze records — a host
   * restart is exactly what the freeze store exists for. Explicit kills
   * (tab close, task-deletion sweep, `rove reset`'s store wipe) stay gone.
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
   * Rebuild sessions from freeze records at host boot — each comes back as
   * a dead "restored" corpse with its ring intact; the first `open`
   * respawns the child in place. Records for keys this host already has
   * (never in practice — restore runs before listen) lose. Returns how
   * many sessions thawed.
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
   * Bring a freeze-restored corpse back to life IN PLACE: the thawed ring
   * stays (the reattaching client replays where the session left off and
   * live output appends after it), the child restarts from the caller's
   * spec when it carries a command, else the frozen one. `restored` clears
   * either way — a failed respawn becomes an ordinary view-only corpse,
   * not a restore candidate retried on every attach.
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
   * Throttled freeze writer. A periodic write happens only when
   * `shouldFreeze` says the whole-ring rewrite has earned itself (see
   * `pty-freeze-policy.ts` for the numbers). `force` (exit, rename,
   * shutdown) writes regardless: an exit record is a change no byte counter
   * can see. Internal keys (the warm spare) never freeze.
   */
  private maybeFreeze(session: PtySessionState, force = false): void {
    const freeze = this.opts.freeze
    if (!freeze || session.key.startsWith("::")) return
    // A session someone CLOSED must not be written back. `kill()` drops the
    // record synchronously and then awaits `endChild`, so the `onExit` freeze
    // lands a tick LATER and recreates exactly the file the drop removed —
    // with a fresh `updatedAt` that survives the TTL prune, so the next host
    // incarnation resurrects a closed tab and replays its old scrollback. The
    // guard belongs here rather than at the call site: every writer through
    // this function owes the same promise.
    if (session.closedByRequest) return
    const now = Date.now()
    if (!force && !shouldFreeze(session, now)) return
    session.lastFreezeAtMs = now
    session.frozenTotalBytes = session.totalBytes
    freeze.save(freezeSession(session))
  }

  /** Sessions whose child is still running — the host process's reason
   *  to stay alive (`pty-server.ts` idle-exits at zero sessions). */
  liveCount(): number {
    let n = 0
    for (const session of this.sessions.values()) if (session.alive) n++
    return n
  }
}
