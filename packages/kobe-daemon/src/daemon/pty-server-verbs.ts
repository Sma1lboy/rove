/**
 * The verbs the PTY host serves — one request in, one reply out.
 *
 * Split from `pty-server.ts` along the wire/lifecycle seam: that file owns
 * the process (socket, pidfile, idle exit, the orphan watchdog, freeze on
 * shutdown) and the frame grammar; this one owns what each named request
 * does to the session host. Nothing here knows how a frame arrives or how
 * the reply is written — `dispatchPtyRequest` returns the payload, and the
 * caller frames it.
 *
 * Every verb answers synchronously except a `pty.kill` that was asked to
 * `wait` for the exit: that one returns a promise, and the caller has to
 * await it before framing (a promise written as-is serialises to `{}`).
 */

import type { Socket } from "node:net"
import type { ClientWriter } from "./client-writer.ts"
import { logDaemonError } from "./crash-log.ts"
import { objectPayload, optionalBoolean, requireString } from "./handler-validators.ts"
import { DAEMON_PROTOCOL_VERSION, type DaemonFrame } from "./protocol.ts"
import type { PtyHost } from "./pty-host.ts"
import { parseTerminalDefaultColors } from "./terminal-colors.ts"

/** One connected client: the socket it arrived on and the writer that
 *  frames replies and PTY output back to it. Doubles as the identity token
 *  the session host keys attached sinks by. */
export interface PtyClientState {
  socket: Socket
  writer: ClientWriter
}

export type PtyRequest = Extract<DaemonFrame, { type: "request" }>

/** What the verbs need from the host process around them. */
export interface PtyVerbDeps {
  readonly ptys: PtyHost
  /** Frame a reply or a PTY event to one client — `pty.open`'s output sink. */
  readonly writeFrame: (client: Pick<PtyClientState, "writer">, frame: DaemonFrame) => void
  /** `daemon.stop`: end the host gracefully, and make the next boot start
   *  fresh instead of restoring the frozen sessions. */
  readonly requestStop: () => void
  /** The Rove build this host runs, echoed by `pty.list` when known. */
  readonly version?: string
}

export function dispatchPtyRequest(req: PtyRequest, client: PtyClientState, deps: PtyVerbDeps): unknown {
  const { ptys } = deps
  switch (req.name) {
    case "hello":
      return { protocolVersion: DAEMON_PROTOCOL_VERSION, ptyHost: true, pid: process.pid }
    case "pty.open": {
      const payload = objectPayload(req.payload)
      return ptys.open(
        requireString(payload, "key"),
        {
          cwd: requireString(payload, "cwd"),
          command: Array.isArray(payload.command)
            ? payload.command.filter((c): c is string => typeof c === "string")
            : undefined,
          shell: typeof payload.shell === "string" ? payload.shell : undefined,
          // undefined, not 80×24: a size-less open must stay size-agnostic
          // (spawn defaults live in the host; reattach must not resize).
          cols: typeof payload.cols === "number" ? payload.cols : undefined,
          rows: typeof payload.rows === "number" ? payload.rows : undefined,
          defaultColors: parseTerminalDefaultColors(payload.defaultColors) ?? undefined,
        },
        client,
        (frame) => deps.writeFrame(client, frame),
        typeof payload.sinceOffset === "number" ? payload.sinceOffset : undefined,
        typeof payload.sincePid === "number" ? payload.sincePid : undefined,
      )
    }
    case "pty.write": {
      const payload = objectPayload(req.payload)
      ptys.write(requireString(payload, "key"), typeof payload.data === "string" ? payload.data : "")
      return {}
    }
    case "pty.resize": {
      const payload = objectPayload(req.payload)
      ptys.resize(
        requireString(payload, "key"),
        typeof payload.cols === "number" ? payload.cols : 80,
        typeof payload.rows === "number" ? payload.rows : 24,
      )
      return {}
    }
    case "pty.kill": {
      const payload = objectPayload(req.payload)
      const key = requireString(payload, "key")
      if ("expectedGeneration" in payload)
        return ptys.killIfGeneration(key, requireString(payload, "expectedGeneration"))
      // `wait`: the caller is about to unlink the child's working directory
      // (a task deletion, a land) and needs the EXIT, not the acknowledgement
      // — a process still exiting inside that directory makes it
      // undeletable on Windows. Bounded by the host's own SIGTERM → SIGKILL
      // grace, so the reply is never held behind a wedged child.
      if (optionalBoolean(payload, "wait") === true) {
        return ptys.kill(key).then(
          () => ({ accepted: true, ended: true }),
          (err) => {
            logDaemonError("pty-kill", err)
            return { accepted: true, ended: false }
          },
        )
      }
      // Same as `killIfGeneration`: the session is dropped synchronously,
      // the child's teardown is not. `accepted` says the request was taken,
      // which is all this reply can honestly claim — and the rejection now
      // reaches `daemon.log` under a tag instead of an anonymous
      // unhandledRejection (see crash-log.ts).
      void ptys.kill(key).catch((err) => logDaemonError("pty-kill", err))
      return { accepted: true }
    }
    case "pty.rename": {
      const payload = objectPayload(req.payload)
      return { renamed: ptys.rename(requireString(payload, "from"), requireString(payload, "to")) }
    }
    case "pty.detach":
      {
        const payload = objectPayload(req.payload)
        ptys.detach(
          requireString(payload, "key"),
          client,
          payload.parked === true,
          typeof payload.parkedScreenBytes === "number" ? payload.parkedScreenBytes : 0,
        )
      }
      return {}
    case "pty.list":
      return {
        pid: process.pid,
        rssBytes: process.memoryUsage().rss,
        sessions: ptys.list(),
        stats: ptys.stats(),
        ...(deps.version ? { version: deps.version } : {}),
      }
    case "pty.peek": {
      const payload = objectPayload(req.payload)
      return ptys.peek(
        requireString(payload, "key"),
        typeof payload.sinceOffset === "number" ? payload.sinceOffset : undefined,
      )
    }
    case "pty.warm": {
      const payload = objectPayload(req.payload)
      ptys.warm(
        requireString(payload, "cwd"),
        typeof payload.shell === "string" ? payload.shell : undefined,
        typeof payload.cols === "number" ? payload.cols : undefined,
        typeof payload.rows === "number" ? payload.rows : undefined,
      )
      return {}
    }
    case "daemon.stop":
      // Shared graceful-stop verb so `stopDaemonProcess` (kobe reset)
      // works against this socket unchanged. Reset's "starts fresh"
      // contract includes NOT resurrecting frozen sessions next boot.
      deps.requestStop()
      return {}
    default:
      throw new Error(`unknown pty-host request: ${req.name}`)
  }
}
