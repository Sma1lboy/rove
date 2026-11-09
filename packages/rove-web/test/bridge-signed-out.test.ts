/**
 * A revoked token closes the socket with 4401 (rove-bridge
 * `credential-sockets.ts`). The page must not treat that as a dropped
 * connection: retrying cannot work, so it forgets the token and lands on the
 * sign-in screen instead of backing off forever.
 */

import { afterEach, beforeEach, expect, test } from "bun:test"
import { BridgeClient } from "../src/bridge.ts"

class FakeSocket {
  static readonly OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: { id: number; op: string }[] = []
  onopen: (() => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  constructor() {
    FakeSocket.all.push(this)
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw))
  }
  close() {}
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  answerHello() {
    const req = this.sent.filter((s) => s.op === "hello").at(-1)
    if (req) this.onmessage?.({ data: JSON.stringify({ id: req.id, ok: true, result: { protocol: 1 } }) })
  }
}

const saved = { ws: globalThis.WebSocket, window: globalThis.window, localStorage: globalThis.localStorage }
const store = new Map<string, string>()
let timers = 0

beforeEach(() => {
  FakeSocket.all = []
  timers = 0
  store.clear()
  store.set("rove.bridge.token", "t")
  Object.assign(globalThis, {
    WebSocket: FakeSocket,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
    document: { visibilityState: "visible", addEventListener: () => {} },
    window: {
      addEventListener: () => {},
      setTimeout: () => {
        timers++
        return timers
      },
      clearTimeout: () => {},
    },
  })
})

afterEach(() => {
  Object.assign(globalThis, { WebSocket: saved.ws, window: saved.window, localStorage: saved.localStorage })
})

test("a 4401 close forgets the token and stops retrying", async () => {
  const client = new BridgeClient("ws://x/ws", "t")
  client.start()
  FakeSocket.all[0]?.open()
  FakeSocket.all[0]?.answerHello()
  await Promise.resolve()
  expect(client.conn.get().state).toBe("open")

  timers = 0
  FakeSocket.all[0]?.onclose?.({ code: 4401 })
  expect(client.conn.get().hello).toBeNull()
  expect(client.conn.get().failures).toBe(2)
  expect(store.has("rove.bridge.token")).toBe(false)
  // No backoff armed: a reconnect needs a new token from the sign-in screen.
  expect(timers).toBe(0)
  expect(FakeSocket.all).toHaveLength(1)
})

test("an ordinary drop still reconnects", async () => {
  const client = new BridgeClient("ws://x/ws", "t")
  client.start()
  FakeSocket.all[0]?.open()
  FakeSocket.all[0]?.answerHello()
  await Promise.resolve()
  timers = 0
  FakeSocket.all[0]?.onclose?.({ code: 1006 })
  expect(client.conn.get().state).toBe("retrying")
  expect(store.has("rove.bridge.token")).toBe(true)
  expect(timers).toBe(1)
})
