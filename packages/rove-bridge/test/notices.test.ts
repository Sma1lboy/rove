import { afterEach, describe, expect, test } from "bun:test"
import { NoticeFeed, STALE_NOTICE_MS } from "../src/notices.ts"
import { type BridgeDeps, startBridgeServer } from "../src/server.ts"

describe("NoticeFeed", () => {
  const NOW = 1_000_000

  test("delivers a fresh notice once; a replay of the same `at` and anything older is dropped", () => {
    const feed = new NoticeFeed(() => NOW)
    const got: string[] = []
    feed.subscribe((n) => got.push(n.title))
    feed.push({ title: "one", kind: "done", at: NOW - 100 })
    feed.push({ title: "one again", kind: "done", at: NOW - 100 })
    feed.push({ title: "older", kind: "done", at: NOW - 200 })
    feed.push({ title: "two", kind: "error", at: NOW - 50 })
    expect(got).toEqual(["one", "two"])
  })

  test("a reconnect echo of an old notice is not news", () => {
    const feed = new NoticeFeed(() => NOW)
    const got: string[] = []
    feed.subscribe((n) => got.push(n.title))
    feed.push({ title: "stale", kind: "done", at: NOW - STALE_NOTICE_MS - 1 })
    feed.push(null)
    feed.push({ kind: "done", at: NOW } as never)
    expect(got).toEqual([])
  })

  test("optional fields are omitted rather than sent empty", () => {
    const feed = new NoticeFeed(() => NOW)
    const seen: object[] = []
    feed.subscribe((n) => seen.push(n))
    feed.push({ title: "t", kind: "needs_input", at: NOW, body: "", taskId: "T1" })
    expect(seen).toEqual([{ title: "t", kind: "needs_input", at: NOW, taskId: "T1" }])
  })
})

describe("notice push over the socket", () => {
  const TOKEN = "t".repeat(43)
  const servers: Array<{ stop: (force?: boolean) => void }> = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.stop(true)
  })

  test("every connected phone gets a `notice` event; a closed one stops receiving", async () => {
    const feed = new NoticeFeed()
    let subscribers = 0
    const drained = Promise.withResolvers<void>()
    const counted = {
      subscribe(listener: Parameters<NoticeFeed["subscribe"]>[0]) {
        subscribers++
        const off = feed.subscribe(listener)
        return () => {
          off()
          if (--subscribers === 1) drained.resolve()
        }
      },
    }
    const deps: BridgeDeps = {
      token: TOKEN,
      ops: {} as never,
      feed: {
        current: async () => ({ tasks: [], attention: [] }),
        refresh: async () => ({ tasks: [], attention: [] }),
        subscribe: () => () => {},
      },
      notices: counted,
      openPty: () => {
        throw new Error("unused")
      },
      roveVersion: "test",
      log: () => {},
      api: { verb: async () => ({}) as never, rpc: async () => ({}) as never },
      areaOps: {},
    }
    const server = startBridgeServer(deps, { hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    type Frame = { id?: number; event?: string; data?: { title?: string } }
    const open = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      } as unknown as string[])
      const frames: Frame[] = []
      const waiters: Array<() => void> = []
      ws.onmessage = (e) => {
        frames.push(JSON.parse(String(e.data)))
        for (const w of waiters.splice(0)) w()
      }
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error("socket error"))
      })
      const until = async (done: () => boolean): Promise<void> => {
        while (!done()) await new Promise<void>((resolve) => waiters.push(resolve))
      }
      // A round trip orders us after the server's `open`, which is what subscribes.
      ws.send(JSON.stringify({ id: 1, op: "hello", args: {} }))
      await until(() => frames.some((f) => f.id === 1))
      const notices = () => frames.filter((f) => f.event === "notice").map((f) => f.data?.title)
      return { ws, notices, until }
    }
    const a = await open()
    const b = await open()
    feed.push({ title: "deploy done", kind: "done", at: Date.now() })
    await a.until(() => a.notices().length === 1)
    await b.until(() => b.notices().length === 1)
    expect(a.notices()).toEqual(["deploy done"])
    b.ws.close()
    await drained.promise
    feed.push({ title: "next", kind: "done", at: Date.now() + 1 })
    await a.until(() => a.notices().length === 2)
    expect(a.notices()).toEqual(["deploy done", "next"])
    expect(b.notices()).toEqual(["deploy done"])
    a.ws.close()
  })
})
