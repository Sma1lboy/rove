/**
 * Owns ONE hosted session's child lifecycle: spawn, output into its ring
 * buffer + OSC scans, exit, teardown. It knows nothing of the host's session
 * map, sinks, or freeze policy, so a bug here can only damage one session.
 */

import { clearTransientStatuses, createOscSignals, scanOscSignals } from "./osc-signals"

import { randomUUID } from "node:crypto"
import { resolveLoginShell } from "./platform-shell.js"
import type { PtySessionExit } from "./protocol.ts"
import { type PtyDriver, type PtyExit, bunTerminalDriver } from "./pty-driver.ts"
import { embeddedTerminalEnv } from "./pty-env.js"
import { type PtySessionState, type PtySpawnSpec, freshSessionState } from "./pty-host-types.ts"
import { scanOscTitle } from "./pty-observability.ts"
import { terminatePtyChild } from "./pty-termination.ts"
import { foldDefaultColorQueries, formatDefaultColorReply } from "./terminal-colors.ts"
import { scanTerminalModes } from "./terminal-modes.ts"

export interface PtyChildControllerDeps {
  readonly onProgramStatus?: (event: import("./program-status-event").ProgramStatusEvent) => void
  /** How children spawn. Default Bun's; the Windows host injects node-pty's. */
  readonly driver?: PtyDriver
  /** Per-session ring-buffer cap in bytes. */
  readonly scrollbackCap: number
  /** A session's child spawned — cancels a pending daemon idle-stop grace. */
  readonly onSessionStart?: (spare: boolean) => void
  /** Output already folded into the ring; host forwards to sinks + persistence. */
  readonly onOutput?: (session: PtySessionState, data: Buffer) => void
  /** Host emits `pty.exit`, notifies hooks, finalizes persistence. */
  readonly onExit?: (session: PtySessionState, exit: PtySessionExit) => void
  readonly log?: (event: string, message: string) => void
}

/** Child-process lifecycle for a single hosted PTY session. */
export class PtyChildController {
  constructor(private readonly deps: PtyChildControllerDeps) {}

  /** `spare=true` skips `onSessionStart` so a warm shell doesn't pin the host open until adopted. */
  spawn(key: string, spec: PtySpawnSpec, spare = false): PtySessionState {
    const argv = spec.command && spec.command.length > 0 ? [...spec.command] : [spec.shell ?? resolveLoginShell()]
    const session = freshSessionState(key, spec, argv)
    this.startChild(session)
    if (session.alive) {
      this.deps.log?.("pty", `spawned ${argv[0]} for ${key} (pid ${session.proc?.pid})`)
      this.deps.onSessionStart?.(spare)
    }
    return session
  }

  /**
   * Start the child against the session's current command/cwd/size (spawn and
   * respawn share this); on failure the session is dead. Does NOT fire
   * `onSessionStart`: callers own that.
   */
  startChild(session: PtySessionState): void {
    session.generation = randomUUID()
    session.oscSignals = undefined
    session.programStatusEvent = undefined
    this.reportStatus(session, null)
    try {
      session.proc = (this.deps.driver ?? bunTerminalDriver())({
        argv: [...session.command],
        cwd: session.cwd,
        env: embeddedTerminalEnv(process.env, {
          TERM: "xterm-256color",
          COLUMNS: String(session.cols),
          LINES: String(session.rows),
          BASH_SILENCE_DEPRECATION_WARNING: "1",
          ROVE_TERMINAL_PTY: "1",
        }),
        cols: session.cols,
        rows: session.rows,
        onData: (data) => this.onData(session, data),
      })
      session.alive = true
      void session.proc.exited.then(
        (exit) => this.markExited(session, exit),
        () => this.markExited(session),
      )
    } catch (err) {
      session.alive = false
      this.deps.log?.("pty", `spawn failed for ${session.key}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** End the child if it is still running. Idempotent. */
  async endChild(session: PtySessionState): Promise<void> {
    if (!session.alive) return
    const proc = session.proc
    if (!proc) {
      this.markExited(session)
      return
    }
    // Log every signal Rove sends: the only way a post-mortem can tell
    // "Rove killed it" from "something else did" (see pty-termination).
    await terminatePtyChild(
      proc,
      () => this.markExited(session),
      (line) => this.deps.log?.("pty-signal", `${session.key}: ${line}`),
    )
  }

  /** Record the child's death once and notify the host. Idempotent. */
  markExited(session: PtySessionState, exit?: PtyExit): void {
    if (!session.alive) return
    session.alive = false
    if (session.oscSignals) {
      const before = session.oscSignals.records.get("")
      clearTransientStatuses(session.oscSignals)
      if (before !== session.oscSignals.records.get("")) this.reportStatus(session, null)
    }
    const sessionExit: PtySessionExit = {
      code: exit?.code ?? null,
      signal: exit?.signal ?? null,
      at: new Date().toISOString(),
    }
    session.exit = sessionExit
    try {
      session.proc?.close()
    } catch {
      /* already closed */
    }
    this.deps.onExit?.(session, sessionExit)
  }

  private reportStatus(session: PtySessionState, status: import("./osc-signals").ProgramStatus | null): void {
    const event = {
      key: session.key,
      generation: session.generation,
      revision: (session.programStatusEvent?.revision ?? 0) + 1,
      at: Date.now(),
      status,
    }
    session.programStatusEvent = event
    this.deps.onProgramStatus?.(event)
  }

  private onData(session: PtySessionState, data: string | Uint8Array): void {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)
    const text = buf.toString("latin1")
    session.oscSignals ??= createOscSignals()
    const queries = scanOscSignals(session.oscSignals, buf, Date.now(), (status) => this.reportStatus(session, status))
    const colorQueries = foldDefaultColorQueries(session.colorQueryCarry, text)
    session.colorQueryCarry = colorQueries.carry
    // OSC replies must precede DA1: applications use it as a support-detection sentinel.
    const replies = colorQueries.slots.map((slot) => formatDefaultColorReply(slot, session.defaultColors))
    for (let i = 0; i < Math.min(queries, 16); i++) replies.push("\x1b]7501;?\x1b\\")
    const modeReplies = scanTerminalModes(session.modes, text)
    // An attached emulator answers DA1/DECRQM itself; a second answer would
    // desync an app pairing replies to queries.
    if (session.emulatorSinks.size === 0) replies.push(...modeReplies)
    if (replies.length > 0) {
      try {
        session.proc?.write(replies.join(""))
      } catch {
        /* child may have exited between emitting the query and our reply */
      }
    }
    scanOscTitle(session, buf)
    session.chunks.push(buf)
    session.bytes += buf.byteLength
    session.totalBytes += buf.byteLength
    // ponytail: O(chunks) front-trim; may overshoot the cap by a chunk. Replay
    // only needs the recent tail; xterm re-derives the screen from it.
    while (session.bytes > this.deps.scrollbackCap && session.chunks.length > 1) {
      const dropped = session.chunks.shift()
      if (!dropped) break
      session.bytes -= dropped.byteLength
      scanTerminalModes(session.ringModes, dropped.toString("latin1"))
    }
    this.deps.onOutput?.(session, buf)
  }
}
