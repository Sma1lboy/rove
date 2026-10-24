/**
 * The PTY host's verbs: `dispatchPtyRequest` returns the payload and the
 * caller frames it. Every verb is synchronous except `pty.kill` with `wait`,
 * whose promise the caller must await (as-is it serialises to `{}`).
 */

import type { Socket } from "node:net"
import { spawnDetachedDaemon } from "../client/detached-spawn.ts"
import type { ClientWriter } from "./client-writer.ts"
import { logDaemonError } from "./crash-log.ts"
import { objectPayload, optionalBoolean, requireString } from "./handler-validators.ts"
import { DAEMON_PROTOCOL_VERSION, type DaemonFrame, PTY_STOP_REFUSED, type PtyCheckedOpenResult } from "./protocol.ts"
import type { PtyHost } from "./pty-host.ts"
import { parseTerminalDefaultColors } from "./terminal-colors.ts"
import { withoutPtyJob } from "./win-pty-job.ts"

/** One connected client; also the identity token attached sinks are keyed by. */
export interface PtyClientState {
  watchProgramStatus?: boolean
  socket: Socket
  writer: ClientWriter
}

export type PtyRequest = Extract<DaemonFrame, { type: "request" }>

/** What the verbs need from the host process around them. */
export interface PtyVerbDeps {
  readonly ptys: PtyHost
  /** Frame a reply or a PTY event to one client — `pty.open`'s output sink. */
  readonly writeFrame: (client: Pick<PtyClientState, "writer">, frame: DaemonFrame) => void
  /** `daemon.stop`: end gracefully. Sessions are frozen first; the freeze store is never wiped here. */
  readonly requestStop: () => void
  /** The Rove build this host runs, echoed by `pty.list` when known. */
  readonly version?: string
}

export function dispatchPtyRequest(req: PtyRequest, client: PtyClientState, deps: PtyVerbDeps): unknown {
  const { ptys } = deps
  switch (req.name) {
    case "hello":
      return { protocolVersion: DAEMON_PROTOCOL_VERSION, ptyHost: true, pid: process.pid }
    case "pty.openChecked":
    case "pty.open": {
      const payload = objectPayload(req.payload)
      // The comparison and open are synchronous in the one host process.
      if (req.name === "pty.openChecked" && requireString(payload, "admissionToken") !== admissionToken(ptys)) {
        return { kind: "changed" } satisfies PtyCheckedOpenResult
      }
      const open = ptys.open(
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
        payload.answersQueries === true,
      )
      return req.name === "pty.openChecked" ? ({ kind: "opened", open } satisfies PtyCheckedOpenResult) : open
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
    case "pty.watchStatus":
      client.watchProgramStatus = true
      for (const session of ptys.list()) {
        if (session.programStatusEvent)
          deps.writeFrame(client, { type: "event", name: "pty.programStatus", payload: session.programStatusEvent })
      }
      return { supported: true }
    case "pty.list":
      return {
        pid: process.pid,
        rssBytes: process.memoryUsage().rss,
        sessions: ptys.list(),
        admissionToken: admissionToken(ptys),
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
    case "spawn.detached": {
      // Windows only: a session's Job Object traps every launch made inside
      // it, so this host — outside every session job — launches a child of
      // its own Rove instance that must outlive the tab (win-pty-job.ts).
      // No new power: `pty.open` already runs any argv for any client.
      if (process.platform !== "win32") throw new Error("spawn.detached is Windows-only")
      const payload = objectPayload(req.payload)
      const env = objectPayload(payload.env)
      spawnDetachedDaemon(
        requireString(payload, "command"),
        Array.isArray(payload.args) ? payload.args.filter((a): a is string => typeof a === "string") : [],
        withoutPtyJob(
          Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string")),
        ),
        requireString(payload, "logPath"),
      )
      return {}
    }
    case "daemon.stop": {
      // Shared with the daemon so `stopDaemonProcess` works here unchanged. Live sessions end with
      // the host, so only an explicit `force` (rove reset) may stop one that holds any.
      const live = ptys.liveCount()
      if (live > 0 && optionalBoolean(objectPayload(req.payload), "force") !== true) {
        throw Object.assign(new Error(`pty host holds ${live} live session(s); daemon.stop needs force to end them`), {
          name: PTY_STOP_REFUSED,
        })
      }
      deps.requestStop()
      return {}
    }
    default:
      throw new Error(`unknown pty-host request: ${req.name}`)
  }
}

function admissionToken(ptys: PtyHost): string {
  return JSON.stringify(ptys.list().map((s) => [s.key, s.generation, s.pid, s.alive]))
}
