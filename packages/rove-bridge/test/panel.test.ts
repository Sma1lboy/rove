/**
 * What the bridge adds for the side panel: which kind of screen a connection is (decided from the
 * upgrade request, never the page), the `ui.viewing` fields it forwards, and the `panel` push.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { STALE_NOTICE_MS } from "../src/notices.ts"
import { PanelFeed } from "../src/panels.ts"
import { peerOf, viewingFields } from "../src/peer.ts"
import { RowStatusFeed, type StatusClient } from "../src/row-status.ts"
import { AUTH, connect, start, stopServers } from "./server-harness.ts"

afterEach(stopServers)

const upgrade = (headers: Record<string, string> = {}) => new Request("http://127.0.0.1/", { headers })
const NO_TUNNEL = { publicHost: null }

describe("peerOf", () => {
  test("a loopback browser with no tunnel header is local", () => {
    expect(peerOf(upgrade({ "sec-websocket-protocol": "rove.v1" }), "127.0.0.1", NO_TUNNEL)).toEqual({
      surface: "web",
      local: true,
    })
    expect(peerOf(upgrade(), "::1", NO_TUNNEL)).toEqual({ surface: "phone", local: true })
    expect(peerOf(upgrade(), "::ffff:127.0.0.1", NO_TUNNEL).local).toBe(true)
  })

  test("behind cloudflared the peer is loopback too, so the tunnel's own marks decide", () => {
    const tunnelled: Array<Record<string, string>> = [
      { "cf-connecting-ip": "203.0.113.9" },
      { "cf-access-jwt-assertion": "jwt" },
      { "x-forwarded-for": "203.0.113.9" },
      { origin: "https://rove.example.com" },
    ]
    for (const headers of tunnelled) {
      expect(peerOf(upgrade(headers), "127.0.0.1", { publicHost: "rove.example.com" }).local).toBe(false)
    }
    // Access configured: every request is through the tunnel, even one that lost its headers.
    expect(peerOf(upgrade(), "127.0.0.1", { access: {}, publicHost: null }).local).toBe(false)
  })

  test("a page on the machine's own origin stays local when a tunnel hostname is set", () => {
    const req = upgrade({ origin: "http://localhost:5191" })
    expect(peerOf(req, "127.0.0.1", { publicHost: "rove.example.com" }).local).toBe(true)
  })

  test("a LAN or remote peer is not local", () => {
    expect(peerOf(upgrade(), "192.168.1.20", NO_TUNNEL).local).toBe(false)
    expect(peerOf(upgrade(), undefined, NO_TUNNEL).local).toBe(false)
  })
})

describe("viewingFields", () => {
  const web = { surface: "web", local: true } as const

  test("passes the page's layout flags, and the peer's own surface and locality", () => {
    expect(viewingFields({ taskId: "T1", panel: true, panelOpen: false, narrow: false }, web)).toEqual({
      surface: "web",
      local: true,
      panel: true,
      panelOpen: false,
      narrow: false,
    })
  })

  test("the page cannot name its own surface or locality, and sends junk at its peril", () => {
    expect(viewingFields({ surface: "tui", local: true, panel: "yes" }, { surface: "web", local: false })).toEqual({
      surface: "web",
      local: false,
    })
  })

  test("a phone has no panel, whatever it claims", () => {
    expect(viewingFields({ panel: true, narrow: true }, { surface: "phone", local: false })).toEqual({
      surface: "phone",
      local: false,
      narrow: true,
    })
  })
})

describe("RowStatusFeed viewer fields", () => {
  function daemon() {
    const calls: Array<[string, unknown]> = []
    const client: StatusClient = {
      request: async (name, payload) => {
        calls.push([name, payload])
        return { tasks: {}, rev: 0 }
      },
      on: () => () => {},
    }
    return { client, calls }
  }

  test("a change of the layout alone is sent again; an identical report is not", () => {
    const { client, calls } = daemon()
    const feed = new RowStatusFeed(client)
    const closed = { surface: "web", local: true, panel: true, panelOpen: false } as const
    feed.setViewing("bridge-1", "T1", "tab-1", closed)
    feed.setViewing("bridge-1", "T1", "tab-1", { ...closed })
    feed.setViewing("bridge-1", "T1", "tab-1", { ...closed, panelOpen: true })
    expect(calls.map(([, payload]) => payload)).toEqual([
      { viewer: "bridge-1", taskId: "T1", tabId: "tab-1", ...closed },
      { viewer: "bridge-1", taskId: "T1", tabId: "tab-1", ...closed, panelOpen: true },
    ])
  })

  test("a reconnect re-sends the fields with the task", async () => {
    const { client, calls } = daemon()
    const feed = new RowStatusFeed(client)
    feed.setViewing("bridge-1", "T1", null, { surface: "web", local: false, panel: true })
    await feed.resync()
    expect(calls.at(-1)?.[1]).toEqual({ viewer: "bridge-1", taskId: "T1", surface: "web", local: false, panel: true })
  })
})

describe("ui.viewing over the socket", () => {
  function reports() {
    const calls: Array<{ taskId: string | null } & Record<string, unknown>> = []
    const feed = new RowStatusFeed({
      request: async (name, payload) => {
        if (name === "ui.viewing") calls.push(payload as never)
        return { tasks: {}, rev: 0 }
      },
      on: () => () => {},
    })
    return { feed, calls }
  }

  test("a local page's report carries what the page sent plus the bridge's own view of it", async () => {
    const { feed, calls } = reports()
    const h = start({ rowStatus: feed })
    const c = await connect(h.url, AUTH)
    await c.call("ui.viewing", {
      taskId: "T1",
      panel: true,
      panelOpen: true,
      narrow: false,
      surface: "tui",
      local: false,
    })
    // No web subprotocol: this is the phone app, which has no side panel.
    expect(calls[0]).toMatchObject({ taskId: "T1", surface: "phone", local: true, panelOpen: true, narrow: false })
    expect(calls[0]).not.toHaveProperty("panel")
  })

  test("a connection that came through the tunnel is not local", async () => {
    const { feed, calls } = reports()
    const h = start({ rowStatus: feed })
    const c = await connect(h.url, { ...AUTH, "cf-connecting-ip": "203.0.113.9" })
    await c.call("ui.viewing", { taskId: "T1" })
    expect(calls[0]).toMatchObject({ surface: "phone", local: false })
  })
})

describe("PanelFeed", () => {
  const NOW = 1_000_000
  const show = (at: number, extra: object = {}) => ({ taskId: "T1", view: "browser" as const, at, ...extra })

  test("delivers a request once; the daemon's replay of it, or anything older, is dropped", () => {
    const feed = new PanelFeed(() => NOW)
    const got: number[] = []
    feed.subscribe((p) => got.push(p.at))
    feed.push(show(NOW - 100, { url: "https://example.com/" }))
    feed.push(show(NOW - 100, { url: "https://example.com/" }))
    feed.push(show(NOW - 200))
    feed.push(show(NOW - 50))
    expect(got).toEqual([NOW - 100, NOW - 50])
  })

  test("two different requests in one millisecond both arrive", () => {
    const feed = new PanelFeed(() => NOW)
    const got: unknown[] = []
    feed.subscribe((p) => got.push(p.path ?? p.url))
    feed.push(show(NOW - 10, { view: "files", path: "a.ts" }))
    feed.push(show(NOW - 10, { view: "files", path: "b.ts" }))
    expect(got).toEqual(["a.ts", "b.ts"])
  })

  test("a reconnect echo of an old request must not pop the panel", () => {
    const feed = new PanelFeed(() => NOW)
    const got: unknown[] = []
    feed.subscribe((p) => got.push(p))
    feed.push(show(NOW - STALE_NOTICE_MS - 1))
    feed.push(null)
    feed.push({ taskId: "T1", view: "pdf", at: NOW } as never)
    feed.push({ view: "files", at: NOW } as never)
    expect(got).toEqual([])
  })

  test("only the known fields go out", () => {
    const feed = new PanelFeed(() => NOW)
    const got: unknown[] = []
    feed.subscribe((p) => got.push(p))
    feed.push({ ...show(NOW), url: 5, path: "a.ts", extra: true } as never)
    expect(got).toEqual([{ taskId: "T1", view: "browser", at: NOW, path: "a.ts" }])
  })

  test("every connected page gets a `panel` event", async () => {
    const feed = new PanelFeed()
    const h = start({ panels: feed })
    const pages = [await connect(h.url, AUTH), await connect(h.url, AUTH)]
    // A round trip proves the server finished opening each socket (and so subscribed it).
    for (const page of pages) await page.call("ui.viewing", { taskId: null })
    const arrived = pages.map((page) => {
      const got = Promise.withResolvers<void>()
      page.ws.addEventListener("message", () => page.pushes.length > 0 && got.resolve())
      return got.promise
    })
    const request = { taskId: "T1", view: "files" as const, path: "src/a.ts", at: Date.now() }
    feed.push(request)
    await Promise.all(arrived)
    for (const page of pages) expect(page.pushes).toEqual([{ event: "panel", data: request }])
  })
})

describe("hello", () => {
  test("tells the page whether it is on the bridge's machine", async () => {
    const h = start()
    const local = await connect(h.url, AUTH)
    expect((await local.call("hello")).result).toMatchObject({ peer: { surface: "phone", local: true } })
    const tunnelled = await connect(h.url, { ...AUTH, "cf-connecting-ip": "203.0.113.9" })
    expect((await tunnelled.call("hello")).result).toMatchObject({ peer: { local: false } })
  })
})
