/** The bridge server test harness: a real server on port 0, a fake PTY Host and op table, and a minimal client. */

import { TaskFeed } from "../src/feed.ts"
import type { TasksPayload } from "../src/protocol.ts"
import type { RoveOps } from "../src/rove-ops.ts"
import { type BridgeDeps, startBridgeServer } from "../src/server.ts"
import type { PtyHostClient } from "../src/terminal.ts"

export const TOKEN = "t".repeat(43)
export const AUTH = { Authorization: `Bearer ${TOKEN}` }

/** A PTY Host double: one live session, one freeze-restored corpse. */
export class FakePty implements PtyHostClient {
  readonly calls: Array<[string, unknown]> = []
  /** No PTY host process: every request fails the way a connect to a missing socket does. */
  hostDown = false
  readonly closed = Promise.withResolvers<void>()
  private readonly handlers = new Map<string, (frame: { payload: unknown }) => void>()
  async request<T>(name: string, payload?: unknown): Promise<T> {
    this.calls.push([name, payload])
    if (this.hostDown) throw Object.assign(new Error("connect ENOENT /tmp/pty.sock"), { code: "ENOENT" })
    const reply: Record<string, unknown> = {
      "pty.list": {
        sessions: [
          { key: "T1::tab-1", alive: true },
          { key: "T1::tab-2", alive: false, restored: true },
        ],
      },
      "pty.open": { replay: Buffer.from("hello").toString("base64"), alive: true },
      "pty.peek": { data: Buffer.from("frozen").toString("base64") },
    }
    return (reply[name] ?? {}) as T
  }
  on(name: string, handler: (frame: { payload: unknown }) => void): () => void {
    this.handlers.set(name, handler)
    return () => this.handlers.delete(name)
  }
  emit(name: string, payload: unknown): void {
    this.handlers.get(name)?.({ payload })
  }
  close(): void {
    this.closed.resolve()
  }
}

export const ROWS: TasksPayload = { tasks: [], attention: [], gates: [] }

export function fakeOps(): RoveOps {
  const reject = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    tasks: async () => ROWS,
    engines: async () => [],
    repos: async () => [],
    createTask: reject,
    deleteTask: reject,
    landTask: reject,
    tabs: async () => [],
    newTab: reject,
    closeTab: reject,
    reviveTab: reject,
    worktreeOf: async () => "/tmp/wt",
    viewedSession: () => null,
    diffFiles: reject,
    diffFile: reject,
    dismissAttention: reject,
  }
}

export interface Harness {
  url: string
  pty: FakePty
  setRows: (rows: TasksPayload) => void
  feed: TaskFeed
}

const servers: Array<{ stop: (force?: boolean) => void }> = []
/** Each test file calls this from its own `afterEach`. */
export function stopServers(): void {
  for (const s of servers.splice(0)) s.stop(true)
}

export function start(extra: Partial<BridgeDeps> = {}): Harness {
  let rows = ROWS
  const pty = new FakePty()
  const feed = new TaskFeed(async () => rows)
  const deps: BridgeDeps = {
    token: TOKEN,
    ops: { ...fakeOps(), tasks: async () => rows },
    feed,
    openPty: () => pty,
    roveVersion: "test",
    log: () => {},
    api: {
      verb: async () => {
        throw new Error("no verbs in this harness")
      },
      rpc: async () => {
        throw new Error("no RPCs in this harness")
      },
    },
    areaOps: {},
    ...extra,
  }
  const server = startBridgeServer(deps, { hostname: "127.0.0.1", port: 0 })
  servers.push(server)
  return {
    url: `ws://127.0.0.1:${server.port}/`,
    pty,
    feed,
    setRows: (r) => {
      rows = r
    },
  }
}

/** Minimal client: request/response by id, pushes collected. */
export async function connect(url: string, headers?: Record<string, string>) {
  // Bun's WebSocket takes `{ headers }`; the DOM typing only knows protocols.
  const options = (headers ? { headers } : undefined) as unknown as string[] | undefined
  const ws = new WebSocket(url, options)
  const pushes: Array<{ event: string; data: unknown }> = []
  const waiting = new Map<number, (frame: unknown) => void>()
  let next = 0
  ws.onmessage = (e) => {
    const frame = JSON.parse(String(e.data))
    if (frame.event) pushes.push(frame)
    else waiting.get(frame.id)?.(frame)
  }
  const opened = Promise.withResolvers<void>()
  ws.onopen = () => opened.resolve()
  ws.onerror = () => opened.reject(new Error("socket error"))
  await opened.promise
  const call = (op: string, args: Record<string, unknown> = {}) => {
    const id = ++next
    const reply = Promise.withResolvers<{ ok: boolean; result?: unknown; error?: { code: string } }>()
    waiting.set(id, reply.resolve as (frame: unknown) => void)
    ws.send(JSON.stringify({ id, op, args }))
    return reply.promise
  }
  return { ws, call, pushes }
}

export async function upgradeStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
  const res = await fetch(url.replace("ws://", "http://"), {
    headers: {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      ...headers,
    },
  })
  return res.status
}
