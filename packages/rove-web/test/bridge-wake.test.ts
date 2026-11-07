import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BridgeClient } from "../src/bridge.ts"

/** A socket the test drives by hand: it opens, answers or stays silent, like a peer that slept. */
class FakeSocket {
  static readonly OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: { id: number; op: string }[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  constructor() {
    FakeSocket.all.push(this)
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw))
  }
  close() {}
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  answerHello() {
    const req = this.sent.filter((s) => s.op === "hello").at(-1)
    if (req) this.onmessage?.({ data: JSON.stringify({ id: req.id, ok: true, result: { protocol: 1 } }) })
  }
}

let timers: { at: number; fn: () => void; id: number }[] = []
let now = 0
let nextTimer = 1
const listeners = new Map<string, (() => void)[]>()
const saved = { ws: globalThis.WebSocket, window: globalThis.window, document: globalThis.document }

function advance(ms: number) {
  now += ms
  for (;;) {
    const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]
    if (!due) return
    timers = timers.filter((t) => t !== due)
    due.fn()
  }
}

function wake() {
  for (const fn of listeners.get("visibilitychange") ?? []) fn()
}

beforeEach(() => {
  FakeSocket.all = []
  timers = []
  now = 0
  listeners.clear()
  const on = (name: string, fn: () => void) => listeners.set(name, [...(listeners.get(name) ?? []), fn])
  Object.assign(globalThis, {
    WebSocket: FakeSocket,
    document: { visibilityState: "visible", addEventListener: on },
    window: {
      addEventListener: on,
      setTimeout: (fn: () => void, ms: number) => {
        timers.push({ at: now + ms, fn, id: nextTimer })
        return nextTimer++
      },
      clearTimeout: (id: number) => {
        timers = timers.filter((t) => t.id !== id)
      },
    },
  })
})

afterEach(() => {
  Object.assign(globalThis, { WebSocket: saved.ws, window: saved.window, document: saved.document })
})

async function connected(): Promise<BridgeClient> {
  const client = new BridgeClient("ws://x/ws", "t")
  client.start()
  FakeSocket.all[0].open()
  FakeSocket.all[0].answerHello()
  await Promise.resolve()
  expect(client.conn.get().state).toBe("open")
  return client
}

describe("a page coming back from sleep", () => {
  test("drops a socket that no longer answers and reconnects", async () => {
    const client = await connected()
    wake()
    advance(3999)
    expect(client.conn.get().state).toBe("open")
    advance(1)
    expect(client.conn.get().state).toBe("retrying")
    advance(500)
    expect(FakeSocket.all).toHaveLength(2)
  })

  test("keeps a socket that answers", async () => {
    const client = await connected()
    wake()
    FakeSocket.all[0].answerHello()
    await Promise.resolve()
    advance(10_000)
    expect(client.conn.get().state).toBe("open")
    expect(FakeSocket.all).toHaveLength(1)
  })

  test("skips the rest of a long backoff", async () => {
    await connected()
    for (let i = 0; i < 5; i++) {
      const n = FakeSocket.all.length
      FakeSocket.all.at(-1)?.onclose?.()
      while (FakeSocket.all.length === n) advance(100)
    }
    const before = FakeSocket.all.length
    FakeSocket.all.at(-1)?.onclose?.()
    wake()
    expect(FakeSocket.all).toHaveLength(before + 1)
  })

  test("a close during the probe counts once", async () => {
    const client = await connected()
    wake()
    FakeSocket.all[0].onclose?.()
    advance(4000)
    expect(client.conn.get().failures).toBe(1)
    expect(FakeSocket.all).toHaveLength(2)
  })
})

describe("a socket that never finishes connecting", () => {
  test("is dropped after 10s and retried", () => {
    const client = new BridgeClient("ws://x/ws", "t")
    client.start()
    advance(9999)
    expect(client.conn.get().state).toBe("connecting")
    advance(1)
    expect(client.conn.get().state).toBe("retrying")
    advance(500)
    expect(FakeSocket.all).toHaveLength(2)
  })
})
