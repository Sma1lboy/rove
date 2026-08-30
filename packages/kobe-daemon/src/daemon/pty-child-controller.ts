/**
 * PtyChildController — owns one hosted session's child process lifecycle.
 *
 * Split from `pty-host.ts` for the file-size cap. This module is responsible
 * for starting a PTY child, feeding its output bytes into the session's ring
 * buffer + narrow OSC scans, observing its exit, and tearing it down. It does NOT
 * know about the host's session map, client sinks, or freeze policy — those
 * stay in `PtyHost`.
 */

import { resolveLoginShell } from "./platform-shell.js"
import type { PtySessionExit } from "./protocol.ts"
import { type PtyChild, type PtyDriver, type PtyExit, bunTerminalDriver } from "./pty-driver.ts"
import { embeddedTerminalEnv } from "./pty-env.js"
import { type PtySessionState, type PtySpawnSpec, freshSessionState } from "./pty-host-types.ts"
import { scanOscTitle } from "./pty-observability.ts"
import { terminatePtyChild } from "./pty-termination.ts"
import { foldDefaultColorQueries, formatDefaultColorReply } from "./terminal-colors.ts"

export interface PtyChildControllerDeps {
  /** How children spawn. Default Bun's; the Windows host injects node-pty's. */
  readonly driver?: PtyDriver
  /** Per-session ring-buffer cap in bytes. */
  readonly scrollbackCap: number
  /** A session's child spawned — cancels a pending daemon idle-stop grace. */
  readonly onSessionStart?: (spare: boolean) => void
  /** Raw output has been folded into the ring; the host should forward it to
   *  attached sinks (if any) and trigger any persistence it tracks. */
  readonly onOutput?: (session: PtySessionState, data: Buffer) => void
  /** The child exited; the host should emit `pty.exit`, notify hooks, and
   *  finalize persistence. */
  readonly onExit?: (session: PtySessionState, exit: PtySessionExit) => void
  readonly log?: (event: string, message: string) => void
}

/** Child-process lifecycle for a single hosted PTY session. */
export class PtyChildController {
  constructor(private readonly deps: PtyChildControllerDeps) {}

  /**
   * Spawn a new session and start its child. Mirrors `PtyHost.spawn`;
   * `spare=true` skips the `onSessionStart` callback so a warm shell does not
   * pin the host open until it is adopted.
   */
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
   * Start `session`'s child process against its current command/cwd/size —
   * the shared tail of a fresh spawn and a restored session's respawn. On
   * failure the session flips to dead. Does NOT fire `onSessionStart`; callers
   * that want the lifecycle callback must do so themselves (respawn needs its
   * own log line, and warm-spare adoption skips the callback entirely).
   */
  startChild(session: PtySessionState): void {
    try {
      session.proc = (this.deps.driver ?? bunTerminalDriver())({
        argv: [...session.command],
        cwd: session.cwd,
        env: embeddedTerminalEnv(process.env, {
          TERM: "xterm-256color",
          COLUMNS: String(session.cols),
          LINES: String(session.rows),
          BASH_SILENCE_DEPRECATION_WARNING: "1",
          KOBE_TERMINAL_PTY: "1",
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

  private onData(session: PtySessionState, data: string | Uint8Array): void {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)
    const colorQueries = foldDefaultColorQueries(session.colorQueryCarry, buf.toString("latin1"))
    session.colorQueryCarry = colorQueries.carry
    for (const slot of colorQueries.slots) {
      try {
        session.proc?.write(formatDefaultColorReply(slot, session.defaultColors))
      } catch {
        /* child may have exited between emitting the query and our reply */
      }
    }
    scanOscTitle(session, buf)
    session.chunks.push(buf)
    session.bytes += buf.byteLength
    session.totalBytes += buf.byteLength
    // ponytail: O(chunks) front-trim like the web sidecar; a chunk may
    // overshoot the cap slightly — replay correctness only needs "recent
    // tail", the client's xterm re-derives the screen from whatever it gets.
    while (session.bytes > this.deps.scrollbackCap && session.chunks.length > 1) {
      const dropped = session.chunks.shift()
      if (dropped) session.bytes -= dropped.byteLength
    }
    this.deps.onOutput?.(session, buf)
  }
}
