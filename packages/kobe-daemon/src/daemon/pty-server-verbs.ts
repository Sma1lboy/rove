/**
 * The PTY host's verbs: `dispatchPtyRequest` returns the payload and the
 * caller frames it. Every verb is synchronous except `pty.kill` with `wait`,
 * whose promise the caller must await (as-is it serialises to `{}`).
 */

import type { Socket } from "node:net"
import type { ClientWriter } from "./client-writer.ts"
import { logDaemonError } from "./crash-log.ts"
import { objectPayload, optionalBoolean, requireString } from "./handler-validators.ts"
import { DAEMON_PROTOCOL_VERSION, type DaemonFrame } from "./protocol.ts"
import type { PtyHost } from "./pty-host.ts"
import { parseTerminalDefaultColors } from "./terminal-colors.ts"

/** One connected client; also the identity token attached sinks are keyed by. */
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
  /** `daemon.stop`: end gracefully; the next boot starts fresh, not restored. */
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
      // `wait`: the caller will unlink the child's cwd, and a still-exiting
      // process makes it undeletable on Windows. Bounded by the host's
      // SIGTERM → SIGKILL grace, so a wedged child can't hold the reply.
      if (optionalBoolean(payload, "wait") === true) {
        return ptys.kill(key).then(
          () => ({ accepted: true, ended: true }),
          (err) => {
            logDaemonError("pty-kill", err)
            return { accepted: true, ended: false }
          },
        )
      }
      // Session dropped synchronously, teardown not: `accepted` is all this can claim.
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
      // Shared with the daemon so `stopDaemonProcess` works here unchanged.
      deps.requestStop()
      return {}
    default:
      throw new Error(`unknown pty-host request: ${req.name}`)
  }
}
