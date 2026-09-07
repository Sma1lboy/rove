/**
 * The daemon's socket may not accept a request it cannot answer.
 *
 * `createServer`'s connection callback starts dispatching frames the instant
 * the bind resolves, and `dispatch` reads the handler registry through a
 * `const` — so reaching it early throws `ReferenceError: Cannot access
 * 'handlers' before initialization`, not `undefined`. While the registry was
 * built AFTER the bind, a client whose hello landed during the four awaits in
 * between got that ReferenceError back as its response and `rove` printed it
 * and exited 1. The window widened with machine load, which is why it read as
 * a random ~1-in-5 TUI startup flake and never reproduced on CI.
 *
 * The gate below holds the bind open forever, which turns that window from a
 * race into the whole test: any state the dispatch path needs must already
 * exist when `listenOnUnixSocket` resolves.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { type Socket, connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

const gate = vi.hoisted(() => {
  let open = (): void => {}
  const held = new Promise<void>((resolve) => {
    open = resolve
  })
  return { held, open }
})

vi.mock("@sma1lboy/kobe-daemon/daemon/socket-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sma1lboy/kobe-daemon/daemon/socket-guard")>()
  return {
    ...actual,
    // Bind for real, then stop the boot dead. Everything after this point in
    // `startDaemonServer` is unreachable for as long as the test wants.
    listenOnUnixSocket: async (server: Parameters<typeof actual.listenOnUnixSocket>[0], path: string) => {
      await actual.listenOnUnixSocket(server, path)
      await gate.held
    },
  }
})

import { DAEMON_PROTOCOL_VERSION } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { type DaemonServer, startDaemonServer } from "@sma1lboy/kobe-daemon/daemon/server"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { fakeOrchestrator } from "./harness.ts"

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  gate.open()
  await cleanup?.()
  cleanup = null
})

/** Connect as soon as the bind lands — the boot is parked right after it. */
async function connectWhenBound(socketPath: string, timeoutMs = 5000): Promise<Socket> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const socket: Socket = connect(socketPath)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve)
        socket.once("error", reject)
      })
      return socket
    } catch (err) {
      socket.destroy()
      if (Date.now() > deadline) throw err
      await new Promise((r) => setTimeout(r, 10))
    }
  }
}

/** One request frame over a raw socket; resolves with the response frame. */
async function askOverSocket(socketPath: string, name: string, payload: unknown): Promise<Record<string, unknown>> {
  const socket = await connectWhenBound(socketPath)
  try {
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        const nl = buffer.indexOf("\n")
        if (nl !== -1) resolve(JSON.parse(buffer.slice(0, nl)) as Record<string, unknown>)
      })
      socket.once("error", reject)
      socket.once("close", () => reject(new Error("daemon closed the socket without answering")))
    })
    socket.write(`${JSON.stringify({ type: "request", id: "1", name, payload })}\n`)
    return await response
  } finally {
    socket.destroy()
  }
}

it("answers a hello that arrives before the rest of boot finishes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kobe-daemon-boot-"))
  const socketPath = join(dir, "daemon.sock")
  const savedHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = dir

  let server: DaemonServer | undefined
  const booting = startDaemonServer(() => fakeOrchestrator(), {
    runtime: daemonRuntime,
    socketPath,
    pidPath: join(dir, "daemon.pid"),
    homeDir: dir,
    updatePollMs: 0,
    autoTitlePollMs: 0,
    prStatusPollMs: 0,
    uiPrefsDebounceMs: 0,
    keybindingsDebounceMs: 0,
    worktreeChangesTickMs: 0,
    transcriptActivityTickMs: 0,
  }).then((started) => {
    server = started
    return started
  })

  cleanup = async () => {
    await booting.catch(() => {})
    await server?.close().catch(() => {})
    if (savedHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
    else process.env.KOBE_HOME_DIR = savedHome
    rmSync(dir, { recursive: true, force: true })
  }

  const frame = await askOverSocket(socketPath, "hello", { protocolVersion: DAEMON_PROTOCOL_VERSION })

  expect(frame.error).toBeUndefined()
  expect(frame).toMatchObject({ type: "response", name: "hello" })
  expect((frame.payload as { protocolVersion?: number }).protocolVersion).toBeGreaterThan(0)
})
