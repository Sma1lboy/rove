import { mkdtempSync } from "node:fs"
import { type Server, type Socket, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { KobeSocket, RoveSocket } from "../src/socket.ts"

let server: Server | null = null

function fakeDaemon(onFrame: (frame: { id: string; name: string }, sock: Socket) => void): string {
  const path = join(mkdtempSync(join(tmpdir(), "kobe-sdk-sock-")), "d.sock")
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

  it("keeps KobeSocket as a constructor-compatible alias", () => {
    expect(new KobeSocket()).toBeInstanceOf(RoveSocket)
  })

  it("rejects on daemon error frames and routes event frames to the handler", async () => {
    const path = fakeDaemon((frame, sock) => {
      if (frame.name === "boom") {
        sock.write(`${JSON.stringify({ type: "response", id: frame.id, error: { message: "nope" } })}\n`)
      } else {
        sock.write(`${JSON.stringify({ type: "response", id: frame.id, payload: {} })}\n`)
        sock.write(`${JSON.stringify({ type: "event", name: "task.snapshot", payload: { tasks: [] } })}\n`)
      }
    })
    const client = new KobeSocket()
    await client.connect({ socketPath: path })
    await expect(client.request("boom")).rejects.toThrow("nope")
    const seen: string[] = []
    await client.subscribe((name) => seen.push(name), ["task.snapshot"])
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toEqual(["task.snapshot"])
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
    await new Promise((r) => setTimeout(r, 50))
    expect(closes).toHaveLength(1)
  })

  it("stays quiet for the plugin's own close()", async () => {
    const path = fakeDaemon(() => {})
    const client = new RoveSocket()
    let fired = false
    client.onClose(() => {
      fired = true
    })
    await client.connect({ socketPath: path })
    client.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(fired).toBe(false)
  })
})

describe("RoveSocket.hello", () => {
  it("reports the RUNNING daemon's build and channel list under both spellings", async () => {
    const path = fakeDaemon((frame, sock) => {
      const payload =
        frame.name === "hello"
          ? { protocolVersion: 4, minProtocolVersion: 2, kobeVersion: "0.9.142", capabilities: ["task.snapshot"] }
          : {}
      sock.write(`${JSON.stringify({ type: "response", id: frame.id, payload })}\n`)
    })
    const client = new RoveSocket()
    await client.connect({ socketPath: path })
    const info = await client.hello()
    expect(info.roveVersion).toBe("0.9.142")
    expect(info.kobeVersion).toBe("0.9.142")
    expect(info.capabilities).toEqual(["task.snapshot"])
    expect(info.protocolVersion).toBe(4)
    client.close()
  })
})
