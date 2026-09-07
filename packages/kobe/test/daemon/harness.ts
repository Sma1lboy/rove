/**
 * Shared daemon test harness — ONE call boots a real daemon server on a
 * throwaway temp home + temp Unix socket with an injectable orchestrator
 * double; one call tears everything down (clients, raw sockets, server,
 * env, temp dir). One boot path shared by lazy-shutdown / channel-filter /
 * active-task-replay / activity-state (and mirrored by
 * scripts/perf-golden.ts), so every daemon integration test isolates the same
 * way: never the real `~/.rove`, never the default sockets — a test run on
 * the default pty-host socket sweeps the user's live engine sessions — and no
 * leaked clients or sockets between tests.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { type Socket, connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { type DaemonServer, type DaemonServerOptions, startDaemonServer } from "@sma1lboy/kobe-daemon/daemon/server"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import type { Orchestrator } from "../../src/orchestrator/core.ts"

/**
 * Minimal orchestrator double — the daemon boot path only touches
 * `subscribeTasks` (fired once eagerly, warming the bus's `task.snapshot`
 * last-value) + `listTasks`. Tests that need more (e.g. `activeTaskSignal`
 * for the focus replay) pass overrides.
 */
export function fakeOrchestrator(overrides: Record<string, unknown> = {}): Orchestrator {
  return {
    subscribeTasks: (listener: (snapshot: unknown[]) => void) => {
      listener([])
      return () => {}
    },
    listTasks: () => [],
    getTask: () => undefined,
    ...overrides,
  } as unknown as Orchestrator
}

/** Poll `cond` every 10ms until true or the timeout elapses. Returns the final value. */
export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return cond()
}

/** A wire frame as decoded off the raw socket — loose on purpose (adversarial tests). */
export interface RawWireFrame {
  readonly type?: string
  readonly id?: string
  readonly name?: string
  readonly payload?: unknown
  readonly error?: { readonly message: string; readonly name?: string }
}

/**
 * A raw JSON-lines connection to the daemon socket, below `KobeDaemonClient`
 * — for sending malformed/adversarial bytes and asserting on the exact
 * response frames.
 */
export interface RawDaemonSocket {
  readonly socket: Socket
  /** Every frame the daemon has written to this connection, in order. */
  readonly frames: readonly RawWireFrame[]
  sendLine(line: string): void
  /** Convenience: send a well-formed request frame. */
  request(name: string, payload?: unknown, id?: string): void
  /** Resolve the first already-received or future frame matching `match`. */
  nextFrame(match: (frame: RawWireFrame) => boolean, timeoutMs?: number): Promise<RawWireFrame>
  destroy(): void
}

export interface DaemonHarnessOptions {
  orchestrator?: Orchestrator
  /** Overrides merged over the harness defaults (every poller/watcher off). */
  server?: Partial<DaemonServerOptions>
  /** Env vars to set for the daemon's lifetime; restored on `close()`. */
  env?: Record<string, string>
  /** Write into the temp home BEFORE the daemon boots — for state the daemon
   *  only reads at start (the plugin registry, for one). */
  seedHome?: (dir: string) => void
}

export interface DaemonHarness {
  readonly dir: string
  readonly socketPath: string
  readonly pidPath: string
  readonly server: DaemonServer
  /** A tracked socket client — auto-closed by `close()`. */
  client(): KobeDaemonClient
  /** A tracked raw JSON-lines connection — auto-destroyed by `close()`. */
  rawSocket(): Promise<RawDaemonSocket>
  close(): Promise<void>
}

export async function bootDaemonHarness(opts: DaemonHarnessOptions = {}): Promise<DaemonHarness> {
  const dir = mkdtempSync(join(tmpdir(), "kobe-daemon-harness-"))
  const socketPath = join(dir, "daemon.sock")
  const pidPath = join(dir, "daemon.pid")

  // Point every ambient home-dir read at the temp home BEFORE boot, plus any
  // test-specific knobs (grace/TTL envs are read once at server start).
  const savedEnv = new Map<string, string | undefined>()
  const setEnv = (key: string, value: string): void => {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
    process.env[key] = value
  }
  setEnv("KOBE_HOME_DIR", dir)
  for (const [key, value] of Object.entries(opts.env ?? {})) setEnv(key, value)
  opts.seedHome?.(dir)

  const server = await startDaemonServer(() => opts.orchestrator ?? fakeOrchestrator(), {
    runtime: daemonRuntime,
    socketPath,
    pidPath,
    homeDir: dir,
    updatePollMs: 0,
    autoTitlePollMs: 0,
    prStatusPollMs: 0,
    uiPrefsDebounceMs: 0,
    keybindingsDebounceMs: 0,
    worktreeChangesTickMs: 0,
    transcriptActivityTickMs: 0,
    ...opts.server,
  })

  const clients: KobeDaemonClient[] = []
  const rawSockets: RawDaemonSocket[] = []
  const trackClient = (client: KobeDaemonClient): KobeDaemonClient => {
    clients.push(client)
    return client
  }

  let closed = false
  return {
    dir,
    socketPath,
    pidPath,
    server,
    client() {
      return trackClient(new KobeDaemonClient(socketPath))
    },
    rawSocket() {
      return new Promise<RawDaemonSocket>((resolve, reject) => {
        const socket = connect(socketPath)
        const frames: RawWireFrame[] = []
        let buffer = ""
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8")
          let nl = buffer.indexOf("\n")
          while (nl !== -1) {
            const line = buffer.slice(0, nl)
            buffer = buffer.slice(nl + 1)
            if (line.trim().length > 0) {
              try {
                frames.push(JSON.parse(line) as RawWireFrame)
              } catch {
                /* the daemon never writes garbage; ignore partial teardown noise */
              }
            }
            nl = buffer.indexOf("\n")
          }
        })
        socket.on("error", () => {})
        const raw: RawDaemonSocket = {
          socket,
          frames,
          sendLine(line) {
            socket.write(`${line}\n`)
          },
          request(name, payload, id = "1") {
            raw.sendLine(JSON.stringify({ type: "request", id, name, payload }))
          },
          async nextFrame(match, timeoutMs = 2000) {
            await waitFor(() => frames.some(match), timeoutMs)
            const frame = frames.find(match)
            if (!frame) throw new Error(`no matching frame within ${timeoutMs}ms (saw ${frames.length} frames)`)
            return frame
          },
          destroy() {
            socket.destroy()
          },
        }
        socket.once("connect", () => {
          rawSockets.push(raw)
          resolve(raw)
        })
        socket.once("error", reject)
      })
    },
    async close() {
      if (closed) return
      closed = true
      for (const raw of rawSockets) raw.destroy()
      for (const client of clients) client.close()
      await server.close().catch(() => {})
      for (const [key, value] of savedEnv) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
