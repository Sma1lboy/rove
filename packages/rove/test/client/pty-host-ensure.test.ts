/**
 * `ensurePtyHostReachable` against a pty host that is alive but not answering
 * (busy thawing sessions, say) with no pidfile naming it. By pid it looks
 * dead, but it is not: a `daemon.stop` sent to it is read whenever the host
 * next runs, long after this client gave up, and ends every session in it.
 *
 * The stand-in is a real socket that records every request name. It stays
 * silent rather than dropping connections: the probe reads a dropped
 * connection as a reply, which would skip the branch under test.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { type Server, type Socket, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensurePtyHostReachable } from "@sma1lboy/rove-daemon/client/pty-process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

// Short path: macOS caps unix-socket paths at ~104 chars and tmpdir() can be long.
const SOCK_DIR = process.platform === "darwin" ? "/tmp" : tmpdir()
const ENV_NAMES = ["ROVE_PTY_SOCKET_PATH", "ROVE_PTY_PID_PATH", "ROVE_HOME_DIR"] as const

let dir: string
let socketPath: string
let server: Server
const sockets = new Set<Socket>()
const saved = new Map<string, string | undefined>()
const seen: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rove-pty-ensure-"))
  socketPath = join(SOCK_DIR, `rove-pty-ensure-${process.pid}.sock`)
  rmSync(socketPath, { force: true })
  for (const name of ENV_NAMES) saved.set(name, process.env[name])
  process.env.ROVE_PTY_SOCKET_PATH = socketPath
  // Never written: nothing names the host's pid.
  process.env.ROVE_PTY_PID_PATH = join(dir, "pty.pid")
  process.env.ROVE_HOME_DIR = dir
  seen.length = 0
})

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
  rmSync(dir, { recursive: true, force: true })
})

/** Leaves the first `silentConnections` clients hanging, then answers `hello` like a host that caught up. */
async function listenHost(silentConnections: number): Promise<void> {
  let connections = 0
  server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    connections += 1
    const answering = connections > silentConnections
    socket.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        const frame = JSON.parse(line) as { id: string; name: string }
        seen.push(frame.name)
        if (answering && frame.name === "hello") {
          socket.write(`${JSON.stringify({ type: "response", id: frame.id, payload: { protocolVersion: 2 } })}\n`)
        }
      }
    })
  })
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.once("error", reject)
  server.listen(socketPath, () => resolve())
  await promise
}

describe("ensurePtyHostReachable with a silent host and no pidfile", () => {
  it("waits for the host and hands back its own socket", async () => {
    await listenHost(1)

    expect(await ensurePtyHostReachable()).toBe(socketPath)
    expect(seen).not.toContain("daemon.stop")
  }, 30_000)

  // Real time on purpose: the 15s grace window and each probe's 3s hello deadline race real
  // socket I/O, which fake timers cannot drive, so the refusal cannot arrive any sooner.
  it("refuses to restart a host that stays silent, and never sends it daemon.stop", async () => {
    await listenHost(Number.POSITIVE_INFINITY)

    await expect(ensurePtyHostReachable()).rejects.toThrow(/refusing to restart it/)
    expect(seen).not.toContain("daemon.stop")
  }, 60_000)
})
