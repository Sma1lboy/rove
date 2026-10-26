/**
 * The bridge's only network surface: one WebSocket endpoint, plus (under
 * `rove --web`) the browser client's static files. The token is checked at the
 * HTTP upgrade, before a socket exists; every frame afterwards rides that
 * authenticated socket and may only name a core op from `OPS` or an area op
 * registered in `ops/index.ts`. There is no other path to an op.
 */

import { hostname as osHostname } from "node:os"
import { type ApiEnvelope, type ApiParams, ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { ModPaneView } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import type { Server, ServerWebSocket } from "bun"
import { WEB_SUBPROTOCOL, browserOriginAllowed, offersWebSubprotocol, presentedToken, tokenMatches } from "./auth.ts"
import type { AccessVerifier } from "./cf-access.ts"
import type { DispatchFeed } from "./dispatch-feed.ts"
import type { TaskFeed } from "./feed.ts"
import { dismissHitsOnlyGates } from "./gates.ts"
import type { NoticeFeed } from "./notices.ts"
import { AREA_OPS } from "./ops/index.ts"
import type { BridgeApi, OpTable } from "./ops/types.ts"
import type { PromptFeed } from "./prompts.ts"
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
import { routineHook } from "./routine-hook.ts"
import type { RoveOps } from "./rove-ops.ts"
import type { RowStatusFeed } from "./row-status.ts"
import type { TabFeed } from "./tab-feed.ts"
import { type AttachResult, type PtyHostClient, TerminalForwarder } from "./terminal.ts"
import type { WebLogin } from "./web-login.ts"
import { type WebRoot, serveWebFile } from "./web-static.ts"

export interface BridgeDeps {
  readonly token: string
  /** A per-device token's owner (`auth.ts` devices), or null; absent = only the shared token works. */
  readonly deviceOf?: (presented: string | null) => string | null
  readonly ops: RoveOps
  readonly feed: Pick<TaskFeed, "current" | "refresh" | "subscribe">
  /** `rove api notify` toasts, pushed to every connected phone as a `notice` event. */
  readonly notices?: Pick<NoticeFeed, "subscribe">
  /** Plugin input dialogs (`rove api prompt`), pushed to every connected client as a `prompt` event. */
  readonly prompts?: Pick<PromptFeed, "subscribe">
  /** Open mod panes (`mod.ui`), pushed as a `mods` event on connect and on every change. */
  readonly mods?: {
    current(): readonly ModPaneView[]
    subscribe(listener: (panes: readonly ModPaneView[]) => void): () => void
  }
  /** The daemon's dispatch ledger, pushed as a `dispatch` event on connect and on every change. */
  readonly dispatches?: Pick<DispatchFeed, "current" | "subscribe">
  /** Tasks whose Terminal Tabs changed, pushed as a `tabs` event to task subscribers. */
  readonly tabs?: Pick<TabFeed, "subscribe">
  /** The daemon's row status: where `ui.viewing` and answered questions (`term.input`) are reported. */
  readonly rowStatus?: Pick<RowStatusFeed, "setViewing" | "noteInput">
  /** A fresh PTY Host socket for one phone connection. */
  readonly openPty: () => PtyHostClient
  /** The PTY host of a registered machine, over its forwarded socket; absent = this bridge serves no machines. */
  readonly openMachinePty?: (alias: string) => Promise<PtyHostClient>
  readonly roveVersion: string
  /** Cloudflare Access check, run before the token check (`--preset cf`). */
  readonly access?: AccessVerifier
  /** Rejection and destructive-op audit log; never receives the token or the JWT. */
  readonly log?: (line: string) => void
  /** One verb or RPC per call, for area ops. */
  readonly api: BridgeApi
  /** The `api.invoke` op: any verb `api.invoke` serves, run in this process or
   *  on the registered machine `machine` names (or whose task it targets). */
  readonly invoke?: (verb: string, params: ApiParams, machine?: string) => Promise<ApiEnvelope>
  /** Area op allowlist; defaults to `AREA_OPS` (tests inject their own). */
  readonly areaOps?: OpTable
  /** Serve the browser client's files on plain GETs (`rove --web`). */
  readonly web?: WebRoot
  /** `/login` and `/logout` for the browser client (`web-login.ts`). */
  readonly login?: WebLogin
  /** The tunnel hostname (`--public-host`): a browser whose Origin is `https://<it>` is this page. */
  readonly publicHost?: string | null
}

interface Conn {
  /** This connection's screen as the daemon's row status knows it (`ui.viewing`'s `viewer`). */
  readonly viewer: string
  terminal: TerminalForwarder | null
  /** One forwarder per other machine whose terminal this connection opened. */
  machineTerminals: Map<string, Promise<TerminalForwarder>>
  /** Which forwarder owns each attached stream, so input/resize/detach reach the right machine. */
  streamOwner: Map<string, TerminalForwarder>
  unsubscribeTasks: (() => void) | null
  unsubscribeTabs: (() => void) | null
  unsubscribeNotices: (() => void) | null
  unsubscribeMods: (() => void) | null
  unsubscribePrompts: (() => void) | null
  unsubscribeDispatches: (() => void) | null
}

async function handle(deps: BridgeDeps, ws: ServerWebSocket<Conn>, req: Request): Promise<unknown> {
  const { ops } = deps
  const a = req.args
  const conn = ws.data
  const terminal = (): TerminalForwarder => {
    conn.terminal ??= new TerminalForwarder(deps.openPty(), (frame) => ws.send(frame))
    return conn.terminal
  }
  /** The forwarder for the machine a task lives on: this one's, or that machine's PTY host. */
  const terminalFor = async (taskId: string): Promise<TerminalForwarder> => {
    const alias = ops.machineOf?.(taskId)
    if (alias === undefined) return terminal()
    if (!deps.openMachinePty) throw new BridgeError("MACHINE_UNREACHABLE", `this bridge cannot reach machine ${alias}`)
    const open = deps.openMachinePty
    let pending = conn.machineTerminals.get(alias)
    if (!pending) {
      pending = open(alias).then((pty) => new TerminalForwarder(pty, (frame) => ws.send(frame)))
      // A failed open is not cached: the next attach retries once the machine is back.
      pending.catch(() => conn.machineTerminals.delete(alias))
      conn.machineTerminals.set(alias, pending)
    }
    return pending
  }
  const owner = (stream: string): TerminalForwarder => conn.streamOwner.get(stream) ?? terminal()
  if (DESTRUCTIVE_CORE[req.op]) logDestructive(deps, req)
  switch (req.op) {
    case "hello":
      return {
        protocol: BRIDGE_PROTOCOL_VERSION,
        // The verb contract `api.invoke` speaks; the same number as `rove api schema`.
        apiVersion: ROVE_API_VERSION,
        roveVersion: deps.roveVersion,
        host: osHostname(),
      }
    case "api.invoke": {
      if (!deps.invoke) throw new BridgeError("UNKNOWN_OP", "this bridge does not serve verbs")
      const verb = str(a, "verb")
      const params = a.params ?? {}
      if (typeof params !== "object" || params === null || Array.isArray(params)) {
        throw new BridgeError("BAD_ARGS", "params must be an object keyed by flag name")
      }
      if (DESTRUCTIVE_VERBS.has(verb)) logDestructiveVerb(deps, verb, params as Record<string, unknown>)
      const envelope = await deps.invoke(verb, params as ApiParams, optStr(a, "machine"))
      if (envelope.ok) return envelope.result
      throw new BridgeError(envelope.error.code, envelope.error.message, envelope.error)
    }
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
      return ops.deleteTask(str(a, "taskId"), optBool(a, "force"), optBool(a, "cascade"))
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
      const latest = optBool(a, "latest")
      if (kind === "shell" && (prompt !== undefined || engine !== undefined || latest)) {
        throw new BridgeError("BAD_ARGS", "a shell tab takes no prompt or engine")
      }
      return ops.newTab(str(a, "taskId"), { kind, prompt, engine, ...(latest ? { latest } : {}) })
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
      // A viewport tab attaches the session it shows, not one under its own id. Another
      // machine's tab state lives there, so its tabs attach as they are.
      const remote = ops.machineOf?.(taskId) !== undefined
      const shown = remote ? null : ops.viewedSession(taskId, tabId)
      const target = shown?.taskId ?? taskId
      const forwarder = await terminalFor(target)
      const cwd = shown?.cwd ?? (await ops.worktreeOf(taskId))
      const shownTab = shown?.tabId ?? tabId
      const size = cols !== undefined && rows !== undefined ? { cols, rows } : undefined
      const acks = optBool(a, "acks")
      const attach = () => forwarder.attach(target, shownTab, cwd, size, leafId, acks)
      // A tab with no running session reopens as it is opened, the way a TUI attach
      // resumes it (`tab-revive`). When that fails the page still gets the dead tab and
      // its Reopen button. Split panes and another machine's tabs attach as they are.
      const autoRevive = !remote && leafId === undefined
      let attached: AttachResult | null = null
      let gone: unknown = null
      try {
        attached = await attach()
      } catch (err) {
        if (!autoRevive || !(err instanceof BridgeError && err.code === "TAB_NOT_LIVE")) throw err
        gone = err
      }
      if (autoRevive && (gone !== null || attached?.alive === false)) {
        // Let go of the corpse first, so its exit never reaches the page as this tab's.
        if (attached) await forwarder.detach(attached.stream)
        const revived = await ops.reviveTab(target, shownTab).then(
          () => true,
          () => false,
        )
        if (!revived && gone !== null) throw gone
        attached = await attach()
      }
      if (!attached) throw gone
      conn.streamOwner.set(attached.stream, forwarder)
      return attached
    }
    case "term.input": {
      const data = a.data
      if (typeof data !== "string") throw new BridgeError("BAD_ARGS", "data must be a string")
      await owner(str(a, "stream")).input(str(a, "stream"), data)
      deps.rowStatus?.noteInput(str(a, "stream"), data)
      return {}
    }
    case "term.resize":
      await owner(str(a, "stream")).resize(
        str(a, "stream"),
        optInt(a, "cols", 10, 1000) ?? 80,
        optInt(a, "rows", 4, 500) ?? 24,
      )
      return {}
    case "term.ack":
      conn.streamOwner.get(str(a, "stream"))?.ack(str(a, "stream"), optInt(a, "chars", 0, 1e9) ?? 0)
      return {}
    case "term.detach":
      {
        const stream = str(a, "stream")
        const forwarder = conn.streamOwner.get(stream) ?? conn.terminal
        conn.streamOwner.delete(stream)
        await forwarder?.detach(stream)
      }
      return {}
    case "term.revive": {
      const taskId = str(a, "taskId")
      const tabId = str(a, "tabId")
      // The session `term.attach` would open: a viewport tab revives the one it shows.
      const shown = ops.machineOf?.(taskId) !== undefined ? null : ops.viewedSession(taskId, tabId)
      return ops.reviveTab(shown?.taskId ?? taskId, shown?.tabId ?? tabId, optBool(a, "restartExited"))
    }
    case "diff.files":
      return ops.diffFiles(str(a, "taskId"))
    case "diff.file": {
      const scope = str(a, "scope")
      if (scope !== "branch" && scope !== "working") throw new BridgeError("BAD_ARGS", "scope is branch|working")
      return ops.diffFile(str(a, "taskId"), str(a, "path"), scope)
    }
    case "attention.dismiss": {
      const taskId = str(a, "taskId")
      const tabId = optStr(a, "tabId")
      const deliveryId = optStr(a, "deliveryId")
      // A decision is answered (`gate.answer`), never dismissed. A client that names the gate says
      // so; one that predates `gateId` is caught when the tab holds nothing but decision rows.
      if (
        optStr(a, "gateId") ||
        (!deliveryId && dismissHitsOnlyGates((await deps.feed.current()).attention, taskId, tabId))
      ) {
        throw new BridgeError("GATE_NOT_DISMISSABLE", "a decision is answered with gate.answer, not dismissed")
      }
      await ops.dismissAttention(taskId, tabId, deliveryId)
      return {}
    }
    case "ui.viewing": {
      // `taskId: null` = this screen shows no task (the page went hidden).
      const taskId = a.taskId === null ? null : str(a, "taskId")
      deps.rowStatus?.setViewing(conn.viewer, taskId, taskId === null ? null : (optStr(a, "tabId") ?? null))
      return {}
    }
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

/**
 * Verbs that lose work or are hard to undo, audited like {@link DESTRUCTIVE_CORE}.
 * The token already grants a shell (`term.input`), so serving verbs adds no
 * power; the audit line is what keeps a destructive call visible.
 */
const DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set([
  "delete",
  "land",
  "remove-worktree",
  "tab-close",
  "issue-delete",
  "routine-delete",
  "note-delete",
])

function logDestructiveVerb(deps: BridgeDeps, verb: string, params: Record<string, unknown>): void {
  const ids = ["task-id", "tab", "id"]
    .filter((key) => typeof params[key] === "string" || typeof params[key] === "number")
    .map((key) => `${key}=${String(params[key])}`)
  ;(deps.log ?? ((line: string) => console.error(line)))(`[rove-bridge] api.invoke ${verb} ${ids.join(" ")}`.trimEnd())
}

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
    const detail = err instanceof BridgeError ? err.detail : undefined
    ws.send(responseError(req.id, code, err instanceof Error ? err.message : String(err), detail))
  }
}

/** Names each connection's screen for `ui.viewing`; unique across every server this process runs. */
let nextViewer = 0

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
      if (!upgrade) {
        const hook = await routineHook(deps.api, req, log)
        if (hook) return hook
      }
      if (!upgrade && deps.login) {
        const answer = await deps.login.handle(req, server.requestIP(req)?.address ?? "?")
        if (answer) return answer
      }
      if (!upgrade && deps.web) {
        const file = await serveWebFile(deps.web, req)
        if (file) return file
      }
      // Phones send no Origin. A browser always does; one from another site never gets a socket,
      // even holding the token. Absent Origin still needs the token below.
      const origin = req.headers.get("origin")
      if (origin !== null && !browserOriginAllowed(origin, req.headers.get("host"), deps.publicHost ?? null)) {
        log(`[rove-bridge] 403 from ${from}: cross-origin upgrade from ${origin}`)
        return new Response("forbidden\n", { status: 403 })
      }
      const presented = presentedToken(req)
      const device = tokenMatches(deps.token, presented) ? null : (deps.deviceOf?.(presented) ?? undefined)
      if (device === undefined) {
        log(`[rove-bridge] 401 from ${from}: missing or wrong bearer token`)
        return new Response("unauthorized\n", { status: 401 })
      }
      if (device) log(`[rove-bridge] device ${device} connected from ${from}`)
      const data: Conn = {
        viewer: `bridge-${++nextViewer}`,
        terminal: null,
        machineTerminals: new Map(),
        streamOwner: new Map(),
        unsubscribeTasks: null,
        unsubscribeTabs: null,
        unsubscribeNotices: null,
        unsubscribeMods: null,
        unsubscribePrompts: null,
        unsubscribeDispatches: null,
      }
      // A browser drops a socket whose server did not pick one of its offered protocols.
      const headers = offersWebSubprotocol(req) ? { "Sec-WebSocket-Protocol": WEB_SUBPROTOCOL } : undefined
      if (server.upgrade(req, { data, headers })) return undefined
      return new Response("rove-bridge speaks WebSocket only\n", { status: 426 })
    },
    websocket: {
      open(ws) {
        ws.data.unsubscribeNotices = deps.notices?.subscribe((n) => ws.send(pushEvent("notice", n))) ?? null
        ws.data.unsubscribePrompts = deps.prompts?.subscribe((p) => ws.send(pushEvent("prompt", p))) ?? null
        if (deps.mods) {
          ws.send(pushEvent("mods", { panes: deps.mods.current() }))
          ws.data.unsubscribeMods = deps.mods.subscribe((panes) => ws.send(pushEvent("mods", { panes })))
        }
        if (deps.dispatches) {
          const now = deps.dispatches.current()
          if (now) ws.send(pushEvent("dispatch", now))
          ws.data.unsubscribeDispatches = deps.dispatches.subscribe((snapshot) =>
            ws.send(pushEvent("dispatch", snapshot)),
          )
        }
      },
      // Terminal replays reach 512 KiB raw (~700 KiB base64); leave headroom for paste.
      maxPayloadLength: 8 * 1024 * 1024,
      message(ws, message) {
        void onMessage(deps, ws, typeof message === "string" ? message : message.toString("utf8"))
      },
      close(ws) {
        // What this screen showed is no longer looked at.
        deps.rowStatus?.setViewing(ws.data.viewer, null, null)
        ws.data.unsubscribeTasks?.()
        ws.data.unsubscribeTabs?.()
        ws.data.unsubscribeNotices?.()
        ws.data.unsubscribeMods?.()
        ws.data.unsubscribePrompts?.()
        ws.data.unsubscribeDispatches?.()
        ws.data.terminal?.dispose()
        for (const pending of ws.data.machineTerminals.values()) {
          pending.then(
            (forwarder) => forwarder.dispose(),
            () => {},
          )
        }
      },
    },
  })
}
