import { mkdtempSync } from "node:fs"
import { type Server, type Socket, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RoveSocket } from "../src/socket.ts"

let server: Server | null = null

function fakeDaemon(onFrame: (frame: { id: string; name: string }, sock: Socket) => void): string {
  const path = join(mkdtempSync(join(tmpdir(), "rove-sdk-sock-")), "d.sock")
  server = createServer((sock) => {
    let buf = ""
    sock.setEncoding("utf8")
    sock.on("data", (chunk: string) => {
      buf += chunk
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.trim()) onFrame(JSON.parse(line), sock)
      }
    })
  })
  server.listen(path)
  return path
}

afterEach(() => {
  server?.close()
  server = null
})

describe("RoveSocket", () => {
  it("resolves requests with the matching response payload", async () => {
    const path = fakeDaemon((frame, sock) => {
      sock.write(`${JSON.stringify({ type: "response", id: frame.id, payload: { echo: frame.name } })}\n`)
    })
    const client = new RoveSocket()
    await client.connect({ socketPath: path })
    expect(await client.request("task.list")).toEqual({ echo: "task.list" })
    client.close()
  })

  it("rejects on daemon error frames", async () => {
    const path = fakeDaemon((frame, sock) => {
      sock.write(`${JSON.stringify({ type: "response", id: frame.id, error: { message: "nope" } })}\n`)
    })
    const client = new RoveSocket()
    await client.connect({ socketPath: path })
    await expect(client.request("boom")).rejects.toThrow("nope")
    client.close()
  })

  it("routes event frames to the subscriber", async () => {
    const path = fakeDaemon((frame, sock) => {
      sock.write(`${JSON.stringify({ type: "response", id: frame.id, payload: {} })}\n`)
      sock.write(`${JSON.stringify({ type: "event", name: "task.snapshot", payload: { tasks: [] } })}\n`)
    })
    const client = new RoveSocket()
    await client.connect({ socketPath: path })
    const seen: string[] = []
    await client.subscribe((name) => seen.push(name), ["task.snapshot"])
    await vi.waitFor(() => expect(seen).toEqual(["task.snapshot"]))
    client.close()
  })
})

describe("RoveSocket.onClose", () => {
  it("tells a subscriber the connection died, even with no request pending", async () => {
    const sockets: Socket[] = []
    const path = fakeDaemon((frame, sock) => {
      sockets.push(sock)
      sock.write(`${JSON.stringify({ type: "response", id: frame.id, payload: {} })}\n`)
    })
    const client = new RoveSocket()
    const closes: string[] = []
    client.onClose((err) => closes.push(err.message))
    await client.connect({ socketPath: path })
    // A subscriber holds no pending request — the pre-onClose socket failed
    // only those, so a daemon crash reached the plugin as total silence.
    await client.subscribe(() => {})
    sockets[0]?.destroy()
    await vi.waitFor(() => expect(closes).toHaveLength(1))
  })
})

describe("RoveSocket.hello", () => {
  it("reports the RUNNING daemon's build and channel list", async () => {
    const path = fakeDaemon((frame, sock) => {
      const payload = {
        protocolVersion: 4,
        minProtocolVersion: 2,
        roveVersion: "0.9.142",
        capabilities: ["task.snapshot"],
      }
      sock.write(`${JSON.stringify({ type: "response", id: frame.id, payload })}\n`)
    })
    const client = new RoveSocket()
    await client.connect({ socketPath: path })
    const info = await client.hello()
    expect(info.roveVersion).toBe("0.9.142")
    expect(info.capabilities).toEqual(["task.snapshot"])
    expect(info.protocolVersion).toBe(4)
    client.close()
  })
})
