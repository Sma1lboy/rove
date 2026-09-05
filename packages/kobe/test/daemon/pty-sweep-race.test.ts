import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { type Server, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ptyHostHasLiveSessions, sweepPtyHostSessions } from "@sma1lboy/kobe-daemon/client/pty-process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

describe("PTY observation before destructive cleanup", () => {
  let home: string
  let server: Server | undefined
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-sweep-race-"))
    mkdirSync(join(home, ".rove"))
  })
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    rmSync(home, { recursive: true, force: true })
  })
  async function listen(handle: (name: string, payload: Record<string, unknown>) => unknown) {
    server = createServer((socket) => {
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString()
        let at = buffer.indexOf("\n")
        while (at >= 0) {
          const frame = JSON.parse(buffer.slice(0, at))
          buffer = buffer.slice(at + 1)
          const payload = handle(frame.name, frame.payload)
          socket.write(`${JSON.stringify({ type: "response", id: frame.id, name: frame.name, payload })}\n`)
          at = buffer.indexOf("\n")
        }
      })
    })
    await new Promise<void>((resolve) => server?.listen(join(home, ".rove", "pty.sock"), resolve))
  }

  it("keeps a task created after sweep scheduling, before the session inventory returns", async () => {
    let tasks: string[] = []
    const requests: string[] = []
    await listen((name) => {
      requests.push(name)
      tasks = ["new-task"]
      return { sessions: [{ key: "new-task::tab-1", generation: "new", alive: true }] }
    })
    await sweepPtyHostSessions(() => tasks, home)
    expect(requests).toEqual(["pty.list"])
  })

  it("kills only observed generations and rechecks tasks after each async request", async () => {
    const tasks: string[] = []
    const kills: Record<string, unknown>[] = []
    await listen((name, payload) => {
      if (name === "pty.list")
        return {
          sessions: [
            { key: "gone::tab-1", generation: "first" },
            { key: "restored::tab-1", generation: "second" },
          ],
        }
      kills.push(payload)
      tasks.push("restored")
      return { killed: true }
    })
    await sweepPtyHostSessions(() => tasks, home)
    expect(kills).toEqual([{ key: "gone::tab-1", expectedGeneration: "first" }])
  })

  it("skips old hosts without generation support and a shutdown during the read", async () => {
    const requests: string[] = []
    await listen((name) => {
      requests.push(name)
      return { sessions: [{ key: "old::tab-1", alive: true }] }
    })
    await sweepPtyHostSessions(() => [], home)
    await sweepPtyHostSessions(() => null, home)
    expect(requests).toEqual(["pty.list", "pty.list"])
  })

  it("distinguishes confirmed host absence, live sessions, empty inventory and malformed replies", async () => {
    expect(await ptyHostHasLiveSessions(home)).toBe(false)
    let reply: unknown = { sessions: [{ alive: true }] }
    await listen(() => reply)
    expect(await ptyHostHasLiveSessions(home)).toBe(true)
    reply = { sessions: [] }
    expect(await ptyHostHasLiveSessions(home)).toBe(false)
    reply = {}
    expect(await ptyHostHasLiveSessions(home)).toBeNull()
  })
})
