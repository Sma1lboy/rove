/**
 * Local owner-only IPC server (AF_UNIX socket on POSIX, named pipe on Windows) exposing
 * native `WebContentsView` tabs to `rove api web <tab|nav|snap|batch|eval|fetch|handoff>`.
 *
 * Transport is newline-delimited JSON: one `{ id, method, params }` request per line,
 * one `{ id, ok, result | error }` response per line. Decoupled from Electron via a narrow
 * handler interface so tests can drive the full socket protocol without spawning Electron.
 */

import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs"
import { type Server, type Socket, createServer } from "node:net"
import { dirname } from "node:path"
import {
  type BatchStep,
  type BrowserOwner,
  type IpcRequest,
  type IpcResponse,
  desktopBrowserSocketPath,
} from "./browser-protocol"

export interface BrowserIpcHandler {
  listTabs(taskId?: string): unknown
  newTab(opts: {
    url?: string
    taskId?: string
    owner?: BrowserOwner
    waitUntil?: "load" | "domcontentloaded" | "none"
    timeoutMs?: number
  }): Promise<unknown> | unknown
  closeTab(id: string, taskId?: string): unknown
  focusTab(id: string, taskId?: string): unknown
  handoffTab(opts: { id?: string; taskId?: string; owner?: BrowserOwner; reason?: string }): unknown
  navigate(opts: {
    id?: string
    taskId?: string
    url?: string
    go?: "back" | "forward" | "reload"
    waitUntil?: "load" | "domcontentloaded" | "none"
    timeoutMs?: number
  }): Promise<unknown> | unknown
  snap(opts: {
    id?: string
    taskId?: string
    interactive?: boolean
    root?: string
    maxNodes?: number
  }): Promise<unknown> | unknown
  eval(opts: { id?: string; taskId?: string; expr: string; awaitPromise?: boolean }): Promise<unknown> | unknown
  batch(opts: { id?: string; taskId?: string; steps: readonly BatchStep[] }): Promise<unknown> | unknown
  fetch(opts: {
    id?: string
    taskId?: string
    url: string
    method?: string
    headers?: Readonly<Record<string, string>>
    body?: string
  }): Promise<unknown> | unknown
}

const MAX_LINE_BYTES = 4 * 1024 * 1024
const CODE_PREFIX = /^([A-Z][A-Z0-9_]{2,}): /

function isWindowsPipe(path: string): boolean {
  return path.startsWith("\\\\.\\pipe\\") || path.startsWith("//./pipe/")
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function asOwner(v: unknown): BrowserOwner | undefined {
  return v === "human" || v === "agent" ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

async function dispatch(handler: BrowserIpcHandler, req: IpcRequest): Promise<unknown> {
  const p = req.params ?? {}
  switch (req.method) {
    case "tab.list":
      return handler.listTabs(asString(p.taskId))
    case "tab.new":
      return handler.newTab({
        url: asString(p.url),
        taskId: asString(p.taskId),
        owner: asOwner(p.owner),
        waitUntil:
          p.waitUntil === "load" || p.waitUntil === "domcontentloaded" || p.waitUntil === "none"
            ? p.waitUntil
            : undefined,
        timeoutMs: asNumber(p.timeoutMs),
      })
    case "tab.close": {
      const id = asString(p.id)
      if (!id) throw new Error("BAD_FLAG: tab close requires --id")
      return handler.closeTab(id, asString(p.taskId))
    }
    case "tab.focus": {
      const id = asString(p.id)
      if (!id) throw new Error("BAD_FLAG: tab focus requires --id")
      return handler.focusTab(id, asString(p.taskId))
    }
    case "tab.handoff":
    case "handoff":
      return handler.handoffTab({
        id: asString(p.id),
        taskId: asString(p.taskId),
        owner: asOwner(p.owner),
        reason: asString(p.reason),
      })
    case "nav":
      return handler.navigate({
        id: asString(p.id),
        taskId: asString(p.taskId),
        url: asString(p.url),
        go: p.go === "back" || p.go === "forward" || p.go === "reload" ? p.go : undefined,
        waitUntil:
          p.waitUntil === "load" || p.waitUntil === "domcontentloaded" || p.waitUntil === "none"
            ? p.waitUntil
            : undefined,
        timeoutMs: asNumber(p.timeoutMs),
      })
    case "snap":
      return handler.snap({
        id: asString(p.id),
        taskId: asString(p.taskId),
        interactive: p.interactive === true,
        root: asString(p.root),
        maxNodes: asNumber(p.maxNodes),
      })
    case "eval": {
      const expr = typeof p.expr === "string" ? p.expr : ""
      if (!expr) throw new Error("BAD_FLAG: eval requires --expr")
      return handler.eval({
        id: asString(p.id),
        taskId: asString(p.taskId),
        expr,
        awaitPromise: p.awaitPromise !== false,
      })
    }
    case "batch": {
      if (!Array.isArray(p.steps)) throw new Error("BAD_FLAG: batch requires a JSON array of steps")
      return handler.batch({
        id: asString(p.id),
        taskId: asString(p.taskId),
        steps: p.steps as readonly BatchStep[],
      })
    }
    case "fetch": {
      const url = asString(p.url)
      if (!url) throw new Error("BAD_FLAG: fetch requires --url")
      const headers =
        p.headers && typeof p.headers === "object" && !Array.isArray(p.headers)
          ? (p.headers as Record<string, string>)
          : undefined
      return handler.fetch({
        id: asString(p.id),
        taskId: asString(p.taskId),
        url,
        method: asString(p.method),
        headers,
        body: typeof p.body === "string" ? p.body : undefined,
      })
    }
    default:
      throw new Error(`UNKNOWN_METHOD: unsupported browser IPC method "${req.method}"`)
  }
}

function errorResponse(id: string, err: unknown): IpcResponse {
  const raw = err instanceof Error ? err.message : String(err)
  const match = CODE_PREFIX.exec(raw)
  return {
    id,
    ok: false,
    error: match?.[1]
      ? { code: match[1], message: raw.slice(match[0].length) }
      : { code: "BROWSER_ERROR", message: raw },
  }
}

export interface BrowserIpcServer {
  readonly socketPath: string
  close(): Promise<void>
}

export async function startBrowserIpcServer(
  handler: BrowserIpcHandler,
  opts: { readonly socketPath?: string; readonly log?: (msg: string) => void } = {},
): Promise<BrowserIpcServer> {
  const socketPath = opts.socketPath ?? desktopBrowserSocketPath()
  if (!isWindowsPipe(socketPath)) {
    const dir = dirname(socketPath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (existsSync(socketPath)) {
      try {
        unlinkSync(socketPath)
      } catch {
        /* stale socket unlink failed; listen will surface any real conflict */
      }
    }
  }

  const onSocket = (socket: Socket) => {
    socket.setEncoding("utf8")
    let buffer = ""
    socket.on("data", (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) {
        socket.write(`${JSON.stringify(errorResponse("0", new Error("BAD_REQUEST: message exceeds size limit")))}\n`)
        socket.destroy()
        return
      }
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        void handleLine(socket, handler, trimmed)
      }
    })
  }

  const server: Server = createServer(onSocket)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
  if (!isWindowsPipe(socketPath)) {
    try {
      chmodSync(socketPath, 0o600)
    } catch {
      /* best-effort chmod on non-POSIX filesystems */
    }
  }
  opts.log?.(`browser IPC listening on ${socketPath}`)

  return {
    socketPath,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (!isWindowsPipe(socketPath) && existsSync(socketPath)) {
        try {
          unlinkSync(socketPath)
        } catch {
          /* already removed */
        }
      }
    },
  }
}

async function handleLine(socket: Socket, handler: BrowserIpcHandler, line: string): Promise<void> {
  let req: IpcRequest
  try {
    const parsed = JSON.parse(line) as Partial<IpcRequest>
    if (typeof parsed.id !== "string" || typeof parsed.method !== "string") {
      throw new Error("BAD_REQUEST: request requires string id and method")
    }
    req = parsed as IpcRequest
  } catch (err) {
    if (!socket.destroyed) socket.write(`${JSON.stringify(errorResponse("0", err))}\n`)
    return
  }

  let response: IpcResponse
  try {
    const result = await dispatch(handler, req)
    response = { id: req.id, ok: true, result }
  } catch (err) {
    response = errorResponse(req.id, err)
  }
  if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`)
}
