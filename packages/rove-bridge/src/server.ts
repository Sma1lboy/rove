/**
 * The bridge's only network surface: one WebSocket endpoint. The token is
 * checked at the HTTP upgrade, before a socket exists; every frame afterwards
 * rides that authenticated socket and may only name an op from `OPS`.
 */

import { hostname as osHostname } from "node:os"
import type { Server, ServerWebSocket } from "bun"
import { presentedToken, tokenMatches } from "./auth.ts"
import type { AccessVerifier } from "./cf-access.ts"
import type { TaskFeed } from "./feed.ts"
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeError,
  type Request,
  optBool,
  optInt,
  optStr,
  parseRequest,
  pushEvent,
  requestIdOf,
  responseError,
  responseOk,
  str,
} from "./protocol.ts"
import type { RoveOps } from "./rove-ops.ts"
import { type PtyHostClient, TerminalForwarder } from "./terminal.ts"

export interface BridgeDeps {
  readonly token: string
  readonly ops: RoveOps
  readonly feed: Pick<TaskFeed, "current" | "refresh" | "subscribe">
  /** A fresh PTY Host socket for one phone connection. */
  readonly openPty: () => PtyHostClient
  readonly roveVersion: string
  /** Cloudflare Access check, run before the token check (`--preset cf`). */
  readonly access?: AccessVerifier
  /** Rejection log; never receives the token or the JWT. */
  readonly log?: (line: string) => void
}

interface Conn {
  terminal: TerminalForwarder | null
  unsubscribeTasks: (() => void) | null
}

async function handle(deps: BridgeDeps, ws: ServerWebSocket<Conn>, req: Request): Promise<unknown> {
  const { ops } = deps
  const a = req.args
  const conn = ws.data
  const terminal = (): TerminalForwarder => {
    conn.terminal ??= new TerminalForwarder(deps.openPty(), (frame) => ws.send(frame))
    return conn.terminal
  }
  switch (req.op) {
    case "hello":
      return { protocol: BRIDGE_PROTOCOL_VERSION, roveVersion: deps.roveVersion, host: osHostname() }
    case "tasks.subscribe": {
      // Snapshot first: subscribing before the read would also push it. Cached (only the
      // first subscriber pays a read), with `forMs` aged to now — see `TaskFeed.current`.
      const snapshot = await deps.feed.current()
      conn.unsubscribeTasks ??= deps.feed.subscribe((payload) => ws.send(pushEvent("tasks", payload)))
      return snapshot
    }
    case "tasks.list":
      return deps.feed.refresh()
    case "engines.list":
      return { engines: await ops.engines() }
    case "repos.list":
      return { repos: await ops.repos() }
    case "task.create":
      return ops.createTask({
        repo: str(a, "repo"),
        engine: optStr(a, "engine"),
        prompt: optStr(a, "prompt"),
        title: optStr(a, "title"),
      })
    case "task.delete":
      return ops.deleteTask(str(a, "taskId"), optBool(a, "force"))
    case "task.land": {
      const strategy = optStr(a, "strategy") ?? "merge"
      if (strategy !== "merge" && strategy !== "squash") throw new BridgeError("BAD_ARGS", "strategy is merge|squash")
      return ops.landTask(str(a, "taskId"), strategy)
    }
    case "task.tabs":
      return { tabs: await ops.tabs(str(a, "taskId")) }
    case "tab.new":
      return ops.newTab(str(a, "taskId"), str(a, "prompt"), optStr(a, "engine"))
    case "tab.close":
      await ops.closeTab(str(a, "taskId"), str(a, "tabId"))
      return {}
    case "term.attach": {
      const taskId = str(a, "taskId")
      const tabId = str(a, "tabId")
      const cols = optInt(a, "cols", 10, 1000)
      const rows = optInt(a, "rows", 4, 500)
      if ((cols === undefined) !== (rows === undefined)) throw new BridgeError("BAD_ARGS", "cols and rows go together")
      const cwd = await ops.worktreeOf(taskId)
      return terminal().attach(
        taskId,
        tabId,
        cwd,
        cols !== undefined && rows !== undefined ? { cols, rows } : undefined,
      )
    }
    case "term.input": {
      const data = a.data
      if (typeof data !== "string") throw new BridgeError("BAD_ARGS", "data must be a string")
      await terminal().input(str(a, "stream"), data)
      return {}
    }
    case "term.resize":
      await terminal().resize(str(a, "stream"), optInt(a, "cols", 10, 1000) ?? 80, optInt(a, "rows", 4, 500) ?? 24)
      return {}
    case "term.detach":
      await conn.terminal?.detach(str(a, "stream"))
      return {}
    case "diff.files":
      return ops.diffFiles(str(a, "taskId"))
    case "diff.file": {
      const scope = str(a, "scope")
      if (scope !== "branch" && scope !== "working") throw new BridgeError("BAD_ARGS", "scope is branch|working")
      return ops.diffFile(str(a, "taskId"), str(a, "path"), scope)
    }
    case "attention.dismiss":
      await ops.dismissAttention(str(a, "taskId"), optStr(a, "tabId"))
      return {}
  }
}

async function onMessage(deps: BridgeDeps, ws: ServerWebSocket<Conn>, raw: string): Promise<void> {
  let req: Request
  try {
    req = parseRequest(raw)
  } catch (err) {
    const e = err instanceof BridgeError ? err : new BridgeError("BAD_FRAME", String(err))
    ws.send(responseError(requestIdOf(err), e.code, e.message))
    return
  }
  try {
    ws.send(responseOk(req.id, await handle(deps, ws, req)))
  } catch (err) {
    const code = err instanceof BridgeError ? err.code : "INTERNAL"
    ws.send(responseError(req.id, code, err instanceof Error ? err.message : String(err)))
  }
}

export function startBridgeServer(deps: BridgeDeps, listen: { hostname: string; port: number }): Server<Conn> {
  return Bun.serve<Conn, never>({
    hostname: listen.hostname,
    port: listen.port,
    async fetch(req, server) {
      const log = deps.log ?? ((line: string) => console.error(line))
      // Behind cloudflared every peer is 127.0.0.1; Cloudflare names the real client.
      const from = req.headers.get("cf-connecting-ip") ?? server.requestIP(req)?.address ?? "?"
      if (deps.access) {
        try {
          await deps.access.verify(req.headers.get("cf-access-jwt-assertion"))
        } catch (err) {
          log(`[rove-bridge] 401 from ${from}: Cloudflare Access — ${err instanceof Error ? err.message : String(err)}`)
          return new Response("unauthorized\n", { status: 401 })
        }
      }
      if (!tokenMatches(deps.token, presentedToken(req))) {
        log(`[rove-bridge] 401 from ${from}: missing or wrong bearer token`)
        return new Response("unauthorized\n", { status: 401 })
      }
      if (server.upgrade(req, { data: { terminal: null, unsubscribeTasks: null } })) return undefined
      return new Response("rove-bridge speaks WebSocket only\n", { status: 426 })
    },
    websocket: {
      // Terminal replays reach 512 KiB raw (~700 KiB base64); leave headroom for paste.
      maxPayloadLength: 8 * 1024 * 1024,
      message(ws, message) {
        void onMessage(deps, ws, typeof message === "string" ? message : message.toString("utf8"))
      },
      close(ws) {
        ws.data.unsubscribeTasks?.()
        ws.data.terminal?.dispose()
      },
    },
  })
}
