import { describe, expect, test } from "bun:test"
import { type Tunnel, relayTransport } from "../src/relay-adapters.ts"

const TOKEN = "k".repeat(43)

/** A tunnel double: records what the page asks of it; `ready` starts false, like one that dropped. */
function fakeTunnel() {
  const seen = { paths: [] as string[], connects: 0, sent: [] as string[], fetches: [] as unknown[] }
  const sock = {
    onmessage: null as ((data: string | Uint8Array) => void) | null,
    onclose: null as (() => void) | null,
    send: (data: string) => void seen.sent.push(data),
    close: () => sock.onclose?.(),
  }
  let state: Tunnel["state"] = "error"
  const tunnel = {
    get state() {
      return state
    },
    connect: async () => {
      seen.connects++
      state = "ready"
    },
    openSocket: async (path: string) => {
      if (state !== "ready") throw new Error("Tunnel closed")
      seen.paths.push(path)
      return sock
    },
    fetch: async (path: string, init: unknown) => {
      seen.fetches.push({ path, init })
      const status = path === "/logout" ? 204 : 200
      const body = new TextEncoder().encode(JSON.stringify({ password: true }))
      return { status, headers: { "content-type": "application/json" }, bytes: () => body }
    },
  } as unknown as Tunnel
  return { tunnel, sock, seen }
}

describe("relay transport", () => {
  test("a socket reconnects the tunnel, moves the token to ?token=, and speaks WebSocket events", async () => {
    const { tunnel, sock, seen } = fakeTunnel()
    const ws = new (relayTransport(tunnel).WebSocket)("wss://relay.example/ws", ["rove.v1", `rove.bearer.${TOKEN}`])
    const events: string[] = []
    const opened = Promise.withResolvers<void>()
    ws.onopen = () => opened.resolve()
    ws.onmessage = (ev) => events.push(`message ${ev.data}`)
    ws.onclose = () => events.push("close")
    await opened.promise
    expect(seen.connects).toBe(1)
    expect(seen.paths).toEqual([`/ws?token=${TOKEN}`])
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.send('{"id":1}')
    sock.onmessage?.('{"id":1,"ok":true}')
    sock.onclose?.()
    expect(seen.sent).toEqual(['{"id":1}'])
    expect(events).toEqual(['message {"id":1,"ok":true}', "close"])
  })

  test("fetch answers with a real Response the login code can read", async () => {
    const { tunnel, seen } = fakeTunnel()
    const relay = relayTransport(tunnel)
    const res = await relay.fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    expect(res.ok).toBe(true)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(await res.json()).toEqual({ password: true })
    expect(seen.fetches[0]).toEqual({
      path: "/login",
      init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    })
    expect((await relay.fetch("/logout", { method: "POST" })).status).toBe(204)
  })
})
