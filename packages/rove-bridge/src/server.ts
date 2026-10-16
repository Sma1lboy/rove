/**
 * The bridge's only network surface: one WebSocket endpoint, plus (under
 * `rove --web`) the browser client's static files. The token is checked at the
 * HTTP upgrade, before a socket exists; every frame afterwards rides that
 * authenticated socket and may only name a core op from `OPS` or an area op
 * registered in `ops/index.ts`. There is no other path to an op.
 */

import { hostname as osHostname } from "node:os"
import type { Server, ServerWebSocket } from "bun"
import { WEB_SUBPROTOCOL, offersWebSubprotocol, presentedToken, tokenMatches } from "./auth.ts"
import type { AccessVerifier } from "./cf-access.ts"
import type { TaskFeed } from "./feed.ts"
import type { NoticeFeed } from "./notices.ts"
import { AREA_OPS } from "./ops/index.ts"
import type { BridgeApi, OpTable } from "./ops/types.ts"
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeError,
  type Request,
  isCoreOp,
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
import type { TabFeed } from "./tab-feed.ts"
import { type PtyHostClient, TerminalForwarder } from "./terminal.ts"
import { type WebRoot, serveWebFile } from "./web-static.ts"

export interface BridgeDeps {
  readonly token: string
  readonly ops: RoveOps
  readonly feed: Pick<TaskFeed, "current" | "refresh" | "subscribe">
  /** `rove api notify` toasts, pushed to every connected phone as a `notice` event. */
  readonly notices?: Pick<NoticeFeed, "subscribe">
  /** Tasks whose Terminal Tabs changed, pushed as a `tabs` event to task subscribers. */
  readonly tabs?: Pick<TabFeed, "subscribe">
  /** A fresh PTY Host socket for one phone connection. */
  readonly openPty: () => PtyHostClient
  readonly roveVersion: string
  /** Cloudflare Access check, run before the token check (`--preset cf`). */
  readonly access?: AccessVerifier
  /** Rejection and destructive-op audit log; never receives the token or the JWT. */
  readonly log?: (line: string) => void
  /** One verb or RPC per call, for area ops. */
  readonly api: BridgeApi
  /** Area op allowlist; defaults to `AREA_OPS` (tests inject their own). */
  readonly areaOps?: OpTable
  /** Serve the browser client's files on plain GETs (`rove --web`). */
  readonly web?: WebRoot
}

interface Conn {
  terminal: TerminalForwarder | null
  unsubscribeTasks: (() => void) | null
  unsubscribeTabs: (() => void) | null
  unsubscribeNotices: (() => void) | null
}

async function handle(deps: BridgeDeps, ws: ServerWebSocket<Conn>, req: Request): Promise<unknown> {
  const { ops } = deps
  const a = req.args
  const conn = ws.data
  const terminal = (): TerminalForwarder => {
    conn.terminal ??= new TerminalForwarder(deps.openPty(), (frame) => ws.send(frame))
    return conn.terminal
  }
  if (DESTRUCTIVE_CORE[req.op]) logDestructive(deps, req)
  switch (req.op) {
    case "hello":
      return { protocol: BRIDGE_PROTOCOL_VERSION, roveVersion: deps.roveVersion, host: osHostname() }
    case "tasks.subscribe": {
      // Snapshot first: subscribing before the read would also push it. Cached (only the
      // first subscriber pays a read), with `forMs` aged to now — see `TaskFeed.current`.
      const snapshot = await deps.feed.current()
      conn.unsubscribeTasks ??= deps.feed.subscribe((payload) => ws.send(pushEvent("tasks", payload)))
      conn.unsubscribeTabs ??= deps.tabs?.subscribe((taskIds) => ws.send(pushEvent("tabs", { taskIds }))) ?? null
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
    case "tab.new": {
      const prompt = optStr(a, "prompt")
      const kind = optStr(a, "kind") ?? "engine"
      if (kind !== "shell" && kind !== "engine") throw new BridgeError("BAD_ARGS", "kind is shell|engine")
      const engine = optStr(a, "engine")
      if (kind === "shell" && (prompt !== undefined || engine !== undefined)) {
        throw new BridgeError("BAD_ARGS", "a shell tab takes no prompt or engine")
      }
      return ops.newTab(str(a, "taskId"), { kind, prompt, engine })
    }
    case "tab.close":
      await ops.closeTab(str(a, "taskId"), str(a, "tabId"))
      return {}
    case "term.attach": {
      const taskId = str(a, "taskId")
      const tabId = str(a, "tabId")
      const leafId = optStr(a, "leafId")
      if (leafId !== undefined && !/^leaf-\d{1,4}$/.test(leafId))
        throw new BridgeError("BAD_ARGS", "leafId is not a pane id")
      const cols = optInt(a, "cols", 10, 1000)
      const rows = optInt(a, "rows", 4, 500)
      if ((cols === undefined) !== (rows === undefined)) throw new BridgeError("BAD_ARGS", "cols and rows go together")
      // A viewport tab attaches the session it shows, not one under its own id.
      const shown = ops.viewedSession(taskId, tabId)
      const cwd = shown?.cwd ?? (await ops.worktreeOf(taskId))
      return terminal().attach(
        shown?.taskId ?? taskId,
        shown?.tabId ?? tabId,
        cwd,
        cols !== undefined && rows !== undefined ? { cols, rows } : undefined,
        leafId,
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
    default: {
      const spec = (deps.areaOps ?? AREA_OPS)[req.op]
      // Unreachable for unregistered names: parseRequest already refused them.
      if (!spec) throw new BridgeError("UNKNOWN_OP", `unknown op: ${req.op}`)
      if (spec.destructive) logDestructive(deps, req)
      return spec.run(a, {
        api: deps.api,
        progress: (line) => ws.send(pushEvent("op.progress", { id: req.id, line })),
      })
    }
  }
}

/** Core ops that lose work or are hard to undo; area ops declare it on their spec. */
const DESTRUCTIVE_CORE: Readonly<Record<string, true>> = { "task.delete": true, "task.land": true, "tab.close": true }

/** Audit line for a destructive op: op name and the ids it targets. Never other args, never the token. */
function logDestructive(deps: BridgeDeps, req: Request): void {
  const ids = ["taskId", "tabId", "path"]
    .filter((key) => typeof req.args[key] === "string")
    .map((key) => `${key}=${String(req.args[key])}`)
  ;(deps.log ?? ((line: string) => console.error(line)))(`[rove-bridge] ${req.op} ${ids.join(" ")}`.trimEnd())
}

async function onMessage(deps: BridgeDeps, ws: ServerWebSocket<Conn>, raw: string): Promise<void> {
  let req: Request
  const area = deps.areaOps ?? AREA_OPS
  try {
    req = parseRequest(raw, (op) => isCoreOp(op) || Object.hasOwn(area, op))
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

/** `Origin` names the same host:port the request was sent to (default ports normalised by URL). */
function sameHost(origin: string, host: string | null): boolean {
  try {
    return host !== null && new URL(origin).host === host.toLowerCase()
  } catch {
    return false
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
      const upgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket"
      if (!upgrade && deps.web) {
        const file = await serveWebFile(deps.web, req)
        if (file) return file
      }
      // Phones send no Origin. A browser always does; one from another site never gets a socket,
      // even holding the token. Absent Origin still needs the token below.
      const origin = req.headers.get("origin")
      if (origin !== null && !sameHost(origin, req.headers.get("host"))) {
        log(`[rove-bridge] 403 from ${from}: cross-origin upgrade from ${origin}`)
        return new Response("forbidden\n", { status: 403 })
      }
      if (!tokenMatches(deps.token, presentedToken(req))) {
        log(`[rove-bridge] 401 from ${from}: missing or wrong bearer token`)
        return new Response("unauthorized\n", { status: 401 })
      }
      const data: Conn = { terminal: null, unsubscribeTasks: null, unsubscribeTabs: null, unsubscribeNotices: null }
      // A browser drops a socket whose server did not pick one of its offered protocols.
      const headers = offersWebSubprotocol(req) ? { "Sec-WebSocket-Protocol": WEB_SUBPROTOCOL } : undefined
      if (server.upgrade(req, { data, headers })) return undefined
      return new Response("rove-bridge speaks WebSocket only\n", { status: 426 })
    },
    websocket: {
      open(ws) {
        ws.data.unsubscribeNotices = deps.notices?.subscribe((n) => ws.send(pushEvent("notice", n))) ?? null
      },
      // Terminal replays reach 512 KiB raw (~700 KiB base64); leave headroom for paste.
      maxPayloadLength: 8 * 1024 * 1024,
      message(ws, message) {
        void onMessage(deps, ws, typeof message === "string" ? message : message.toString("utf8"))
      },
      close(ws) {
        ws.data.unsubscribeTasks?.()
        ws.data.unsubscribeTabs?.()
        ws.data.unsubscribeNotices?.()
        ws.data.terminal?.dispose()
      },
    },
  })
}
