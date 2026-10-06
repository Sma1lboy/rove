import { afterEach, describe, expect, test } from "bun:test"
import { AccessDenied, type AccessVerifier } from "../src/cf-access.ts"
import { TaskFeed } from "../src/feed.ts"
import type { OpTable } from "../src/ops/types.ts"
import type { TasksPayload } from "../src/protocol.ts"
import type { RoveOps } from "../src/rove-ops.ts"
import { type BridgeDeps, startBridgeServer } from "../src/server.ts"
import type { PtyHostClient } from "../src/terminal.ts"

const TOKEN = "t".repeat(43)
const AUTH = { Authorization: `Bearer ${TOKEN}` }

/** A PTY Host double: one live session, one freeze-restored corpse. */
class FakePty implements PtyHostClient {
  readonly calls: Array<[string, unknown]> = []
  readonly closed = Promise.withResolvers<void>()
  private readonly handlers = new Map<string, (frame: { payload: unknown }) => void>()
  async request<T>(name: string, payload?: unknown): Promise<T> {
    this.calls.push([name, payload])
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

const ROWS: TasksPayload = { tasks: [], attention: [] }

function fakeOps(): RoveOps {
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
    worktreeOf: async () => "/tmp/wt",
    diffFiles: reject,
    diffFile: reject,
    dismissAttention: reject,
  }
}

interface Harness {
  url: string
  pty: FakePty
  setRows: (rows: TasksPayload) => void
  feed: TaskFeed
}

const servers: Array<{ stop: (force?: boolean) => void }> = []
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true)
})

function start(extra: Partial<BridgeDeps> = {}): Harness {
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
async function connect(url: string, headers?: Record<string, string>) {
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

async function upgradeStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
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

describe("auth", () => {
  test("no token, a wrong token, a same-length wrong token, and a query-string token are all refused", async () => {
    const h = start()
    expect(await upgradeStatus(h.url)).toBe(401)
    expect(await upgradeStatus(h.url, { Authorization: "Bearer nope" })).toBe(401)
    expect(await upgradeStatus(h.url, { Authorization: `Bearer ${"x".repeat(43)}` })).toBe(401)
    // Tunnels and proxies log URLs; only the pairing QR may carry the token.
    expect(await upgradeStatus(`${h.url}?token=${TOKEN}`)).toBe(401)
  })

  test("the right Bearer header opens a socket", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    expect((await c.call("hello")).ok).toBe(true)
  })
})

describe("cloudflare access layer", () => {
  const access: AccessVerifier = {
    async verify(assertion) {
      if (assertion !== "good-jwt")
        throw new AccessDenied(assertion ? "bad JWT signature" : "missing Cf-Access-Jwt-Assertion header")
    },
  }

  test("both layers must pass: a valid token without an Access JWT is refused and logged without secrets", async () => {
    const lines: string[] = []
    const h = start({ access, log: (line) => lines.push(line) })
    expect(await upgradeStatus(h.url, AUTH)).toBe(401)
    expect(await upgradeStatus(h.url, { ...AUTH, "Cf-Access-Jwt-Assertion": "forged" })).toBe(401)
    expect(await upgradeStatus(h.url, { "Cf-Access-Jwt-Assertion": "good-jwt" })).toBe(401)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain("missing Cf-Access-Jwt-Assertion")
    expect(lines.join("\n")).not.toContain(TOKEN)
    expect(lines.join("\n")).not.toContain("forged")
  })

  test("a valid Access JWT plus the token opens a socket", async () => {
    const h = start({ access })
    const c = await connect(h.url, { ...AUTH, "Cf-Access-Jwt-Assertion": "good-jwt" })
    expect((await c.call("hello")).ok).toBe(true)
  })
})

describe("op allowlist", () => {
  test("an op outside the allowlist is refused by name, not passed to the daemon", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    const res = await c.call("task.setActive", { taskId: "T1" })
    expect(res.error?.code).toBe("UNKNOWN_OP")
  })

  test("a malformed frame gets an error reply instead of killing the socket", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    const bad = Promise.withResolvers<string>()
    c.ws.addEventListener("message", (e) => bad.resolve(String(e.data)), { once: true })
    c.ws.send("{not json")
    expect(JSON.parse(await bad.promise).error.code).toBe("BAD_FRAME")
    expect((await c.call("hello")).ok).toBe(true)
  })

  test("a registered area op runs on the authenticated socket; a destructive one is audited by id, never the token", async () => {
    const lines: string[] = []
    const calls: string[] = []
    const areaOps: OpTable = {
      "demo.read": { kind: "read", destructive: false, wraps: "test", run: async () => ({ ok: 1 }) },
      "demo.remove": {
        kind: "write",
        destructive: true,
        wraps: "test",
        run: async (args) => {
          calls.push(String(args.taskId))
          return {}
        },
      },
    }
    const h = start({ areaOps, log: (line) => lines.push(line) })
    expect(await upgradeStatus(h.url)).toBe(401)
    const c = await connect(h.url, AUTH)
    lines.length = 0 // drop the refused-upgrade line above
    expect((await c.call("demo.read")).result).toEqual({ ok: 1 })
    expect(lines).toHaveLength(0)
    await c.call("demo.remove", { taskId: "T7", secret: "s3cret" })
    expect(calls).toEqual(["T7"])
    expect(lines).toEqual(["[rove-bridge] demo.remove taskId=T7"])
    expect(lines.join("\n")).not.toContain(TOKEN)
    expect(lines.join("\n")).not.toContain("s3cret")
    expect((await c.call("demo.other")).error?.code).toBe("UNKNOWN_OP")
  })
})

describe("task feed", () => {
  test("a subscriber gets the snapshot, then a push when a row changes or a new episode starts, not when only its age ticks", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    const first = await c.call("tasks.subscribe")
    expect(first.result).toEqual(ROWS)
    const row = {
      id: "T1",
      title: "t",
      branch: "b",
      repo: "/r",
      kind: "task",
      status: "backlog",
      group: "working" as const,
      rank: 3,
      activity: { state: "running", forMs: 1, since: 5000 },
      engine: null,
      pr: null,
      report: null,
      deleting: false,
    }
    h.setRows({ tasks: [row], attention: [] })
    await h.feed.refresh()
    h.setRows({ tasks: [{ ...row, activity: { state: "running", forMs: 9000, since: 5000 } }], attention: [] })
    await h.feed.refresh()
    // Same state, but the next turn: the phone must rebase its timer.
    h.setRows({ tasks: [{ ...row, activity: { state: "running", forMs: 2, since: 60000 } }], attention: [] })
    await h.feed.refresh()
    // The socket is FIFO: a reply after the refreshes trails any push they sent.
    await c.call("hello")
    expect(c.pushes.filter((p) => p.event === "tasks")).toHaveLength(2)
  })

  test("a later subscriber gets the cached list without a read, its timers aged to now", async () => {
    let clock = 1_000_000
    let reads = 0
    const row = {
      id: "T1",
      title: "t",
      branch: "b",
      repo: "/r",
      kind: "task",
      status: "backlog",
      group: "working" as const,
      rank: 3,
      activity: { state: "running", forMs: 4000 },
      engine: null,
      pr: null,
      report: null,
      deleting: false,
    }
    const feed = new TaskFeed(
      async () => {
        reads++
        return { tasks: [row], attention: [] }
      },
      () => clock,
    )
    await feed.current()
    clock += 7000
    const later = await feed.current()
    expect(reads).toBe(1)
    expect(later.tasks[0]?.activity?.forMs).toBe(11_000)
  })
})

describe("terminal forwarding", () => {
  test("attach replays the shared session, forwards only attached streams, and input reaches the PTY", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)

    const early = await c.call("term.input", { stream: "T1::tab-1", data: "x" })
    expect(early.error?.code).toBe("NOT_ATTACHED")

    const attached = await c.call("term.attach", { taskId: "T1", tabId: "tab-1" })
    expect(attached.result).toEqual({
      stream: "T1::tab-1",
      alive: true,
      replay: Buffer.from("hello").toString("base64"),
    })
    // Size-less attach must not resize the session the TUI is also drawing.
    const open = h.pty.calls.find(([n]) => n === "pty.open")?.[1] as Record<string, unknown>
    expect(open.cols).toBeUndefined()

    h.pty.emit("pty.data", { key: "T1::tab-1", data: "AAA=" })
    h.pty.emit("pty.data", { key: "OTHER::tab-1", data: "BBB=" })
    await c.call("term.input", { stream: "T1::tab-1", data: "yes\r" })
    expect(h.pty.calls).toContainEqual(["pty.write", { key: "T1::tab-1", data: "yes\r" }])
    expect(c.pushes.filter((p) => p.event === "term.data")).toEqual([
      { event: "term.data", data: { stream: "T1::tab-1", data: "AAA=" } },
    ])

    await c.call("term.detach", { stream: "T1::tab-1" })
    h.pty.emit("pty.data", { key: "T1::tab-1", data: "CCC=" })
    await c.call("hello")
    expect(c.pushes.filter((p) => p.event === "term.data")).toHaveLength(1)
  })

  test("attach never spawns: an unknown tab is refused and a restored corpse is only peeked", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    expect((await c.call("term.attach", { taskId: "T1", tabId: "tab-9" })).error?.code).toBe("TAB_NOT_LIVE")
    const frozen = await c.call("term.attach", { taskId: "T1", tabId: "tab-2" })
    expect(frozen.result).toMatchObject({ alive: false, replay: Buffer.from("frozen").toString("base64") })
    expect(h.pty.calls.some(([n]) => n === "pty.open")).toBe(false)
  })

  test("fit-to-phone attach carries the phone's size; closing the socket releases the PTY connection", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    await c.call("term.attach", { taskId: "T1", tabId: "tab-1", cols: 48, rows: 30 })
    const open = h.pty.calls.find(([n]) => n === "pty.open")?.[1]
    expect(open).toMatchObject({ key: "T1::tab-1", cols: 48, rows: 30 })
    c.ws.close()
    await h.pty.closed.promise
  })
})
