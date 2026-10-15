import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TaskFeed } from "../src/feed.ts"
import type { RoveOps } from "../src/rove-ops.ts"
import { type BridgeDeps, startBridgeServer } from "../src/server.ts"
import type { PtyHostClient } from "../src/terminal.ts"

const TOKEN = "w".repeat(43)

const servers: Array<{ stop: (force?: boolean) => void }> = []
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true)
})

function webRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "rove-web-"))
  writeFileSync(join(root, "index.html"), "<!doctype html><title>shell</title>")
  mkdirSync(join(root, "assets"))
  writeFileSync(join(root, "assets", "app-abc.js"), "console.log(1)")
  writeFileSync(join(tmpdir(), "rove-web-secret.txt"), "outside")
  return root
}

function start(extra: Partial<BridgeDeps> = {}): { http: string; ws: string; lines: string[] } {
  const lines: string[] = []
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  const ops: RoveOps = {
    tasks: async () => ({ tasks: [], attention: [] }),
    engines: async () => [],
    repos: async () => [],
    createTask: unused,
    deleteTask: unused,
    landTask: unused,
    tabs: async () => [],
    newTab: unused,
    closeTab: unused,
    worktreeOf: async () => "/tmp",
    diffFiles: unused,
    diffFile: unused,
    dismissAttention: unused,
  }
  const pty: PtyHostClient = { request: unused, on: () => () => {}, close: () => {} }
  const deps: BridgeDeps = {
    token: TOKEN,
    ops,
    feed: new TaskFeed(ops.tasks),
    openPty: () => pty,
    roveVersion: "test",
    log: (line) => lines.push(line),
    api: { verb: unused, rpc: unused },
    areaOps: {},
    ...extra,
  }
  const server = startBridgeServer(deps, { hostname: "127.0.0.1", port: 0 })
  servers.push(server)
  return { http: `http://127.0.0.1:${server.port}`, ws: `ws://127.0.0.1:${server.port}/ws`, lines }
}

function open(url: string, protocols: string[]): Promise<WebSocket> {
  const ws = new WebSocket(url, protocols)
  const { promise, resolve, reject } = Promise.withResolvers<WebSocket>()
  ws.onopen = () => resolve(ws)
  ws.onerror = () => reject(new Error("refused"))
  return promise
}

describe("browser token", () => {
  test("a token offered as a subprotocol opens a socket, and only rove.v1 is echoed back", async () => {
    const h = start()
    const ws = await open(h.ws, ["rove.v1", `rove.bearer.${TOKEN}`])
    expect(ws.protocol).toBe("rove.v1")
    ws.close()
  })

  test("a wrong subprotocol token is refused and never logged", async () => {
    const h = start()
    await expect(open(h.ws, ["rove.v1", `rove.bearer.${"x".repeat(43)}`])).rejects.toThrow()
    expect(h.lines.join("\n")).not.toContain("x".repeat(43))
  })
})

describe("origin", () => {
  const upgrade = (url: string, headers: Record<string, string>) =>
    fetch(url.replace("ws://", "http://"), {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers,
      },
    }).then((r) => r.status)

  test("another site holding the token gets no socket", async () => {
    const h = start()
    expect(await upgrade(h.ws, { Origin: "https://evil.example", Authorization: `Bearer ${TOKEN}` })).toBe(403)
  })

  test("a same-origin browser without the token still gets no socket", async () => {
    const h = start()
    expect(await upgrade(h.ws, { Origin: h.http })).toBe(401)
  })
})

describe("static client", () => {
  test("serves the shell for / and client routes, assets by path, with a CSP", async () => {
    const h = start({ web: { root: webRoot() } })
    const shell = await fetch(`${h.http}/`)
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain("shell")
    expect(shell.headers.get("content-security-policy")).toContain("default-src 'self'")
    expect(await (await fetch(`${h.http}/tasks/abc`)).text()).toContain("shell")
    const asset = await fetch(`${h.http}/assets/app-abc.js`)
    expect(asset.headers.get("cache-control")).toContain("immutable")
    expect((await fetch(`${h.http}/assets/missing.js`)).status).toBe(404)
  })

  test("a traversal path never leaves the root", async () => {
    const h = start({ web: { root: webRoot() } })
    const res = await fetch(`${h.http}/%2e%2e/rove-web-secret.txt`)
    expect(await res.text()).not.toContain("outside")
  })

  test("without --web a plain GET is not a page", async () => {
    const h = start()
    expect((await fetch(`${h.http}/`)).status).toBe(401)
  })
})
