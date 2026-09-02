/**
 * A harness PTY host must not outlive the run that created it — and an
 * ATTACHED one must survive regardless of age.
 *
 * The leak this pins: hosts stranded for days, each holding idle shells for a
 * fixture home that is already deleted. A harness run tearing down between
 * `stopDaemonProcess` and its `rm -rf` takes the socket and pidfile with the
 * home, while the live sessions keep both the host's idle-exit and the
 * daemon's `PtyLiveHold` armed forever — and nothing can address the host
 * afterwards, because its address was the thing deleted.
 *
 * Both halves have to hold, and only together: a host that exits when its
 * owner is gone but ALSO exits while someone is watching would kill the
 * owner's interactive `dev:sandbox`. The signal is possession of its own
 * pidfile, never age and never the process table — a name-matching sweep
 * kills live engines.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { type Socket, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { stopDaemonProcess } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import type { PtyChild, PtyDriver, PtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-driver"
import { type PtyHostServer, startPtyHostServer } from "@sma1lboy/kobe-daemon/daemon/pty-server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let dir: string
let socketPath: string
let pidPath: string
let freezeDir: string
let savedHome: string | undefined
const servers: PtyHostServer[] = []
const clients: KobeDaemonClient[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kobe-pty-orphan-"))
  socketPath = join(dir, "pty.sock")
  pidPath = join(dir, "pty.pid")
  freezeDir = join(dir, "pty-sessions")
  savedHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = dir
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  for (const server of servers.splice(0)) await server.close().catch(() => {})
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = savedHome
  rmSync(dir, { recursive: true, force: true })
})

/** A child that never exits on its own — the idle shells the orphans held. */
class IdleChild {
  static nextPid = 4000
  readonly pid = IdleChild.nextPid++
  private settle!: (exit: PtyExit) => void
  readonly exited = new Promise<PtyExit>((resolve) => {
    this.settle = resolve
  })
  write(): void {}
  resize(): void {}
  close(): void {}
  kill(signal: NodeJS.Signals): void {
    this.settle({ code: null, signal })
  }
}

const idleDriver: PtyDriver = () => new IdleChild() as unknown as PtyChild

/** Fast watchdog so the test measures the RULE, not the production cadence. */
async function bootHost(): Promise<PtyHostServer> {
  const server = await startPtyHostServer({
    socketPath,
    pidPath,
    freezeDir,
    driver: idleDriver,
    idleExitMs: 60_000,
    orphanCheckMs: 50,
    maxLifetimeMs: null,
  })
  servers.push(server)
  return server
}

async function connect(): Promise<KobeDaemonClient> {
  const client = new KobeDaemonClient(socketPath)
  await client.connect()
  clients.push(client)
  return client
}

/** True once the host has stopped serving; false if it is still up at `ms`. */
async function stoppedWithin(ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const probe = new KobeDaemonClient(socketPath)
    try {
      await probe.connect()
      await probe.request("hello")
      probe.close()
    } catch {
      probe.close()
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

describe("pty host self-termination when its owner is gone", () => {
  it("exits when its pidfile is deleted, even holding live sessions", async () => {
    await bootHost()
    const client = await connect()
    await client.request("pty.open", { key: "fixture::tab-1", cwd: dir, command: ["/bin/zsh"] })
    const listed = await client.request<{ sessions: Array<{ alive: boolean }> }>("pty.list", {})
    expect(listed.sessions.filter((s) => s.alive)).toHaveLength(1)

    // The `rm -rf VISUAL_ROOT` half of the leak: the home, and with it every
    // handle on this process, disappears while its sessions are live.
    rmSync(pidPath, { force: true })

    expect(await stoppedWithin(3000)).toBe(true)
  })

  it("exits when a second host takes over its pidfile", async () => {
    await bootHost()
    const client = await connect()
    await client.request("pty.open", { key: "fixture::tab-1", cwd: dir, command: ["/bin/zsh"] })

    // Somebody else now owns this address; we are the stranded one.
    writeFileSync(pidPath, `${process.pid + 1}\n`, "utf8")

    expect(await stoppedWithin(3000)).toBe(true)
  })

  it("STAYS UP for an attached sandbox: pidfile still ours, sessions live", async () => {
    await bootHost()
    const client = await connect()
    await client.request("pty.open", { key: "sandbox::tab-1", cwd: dir, command: ["/bin/zsh"] })

    // Many watchdog ticks (50ms cadence) with the pidfile untouched — the
    // owner's long-lived `dev:sandbox` must not be killed for being old.
    expect(await stoppedWithin(600)).toBe(false)
    const alive = await client.request<{ sessions: Array<{ alive: boolean }> }>("pty.list", {})
    expect(alive.sessions.filter((s) => s.alive)).toHaveLength(1)
  })

  it("honours a fixture lifetime ceiling, which production leaves unset", async () => {
    const server = await startPtyHostServer({
      socketPath,
      pidPath,
      freezeDir,
      driver: idleDriver,
      idleExitMs: 60_000,
      orphanCheckMs: 25,
      maxLifetimeMs: 1,
    })
    servers.push(server)
    const client = await connect()
    await client.request("pty.open", { key: "fixture::tab-1", cwd: dir, command: ["/bin/zsh"] })

    expect(await stoppedWithin(3000)).toBe(true)
  })
})

describe("stopDaemonProcess never erases a live host's address", () => {
  it("keeps the pidfile a live process claimed while the stop was in flight", async () => {
    // The race that strands a host: a reset reads a stale/dead pid, decides
    // nothing is running, and unlinks — while `ensurePtyHostReachable` is
    // concurrently spawning a host that writes its pid into that same file.
    // The unlink then leaves the newborn with no address anyone can reach.
    //
    // A server that accepts and never answers holds `daemon.stop` open for its
    // full 2s budget, which is the window the real race lives in.
    const stallSocket = join(dir, "stall.sock")
    // Hold every inbound socket so it can be destroyed at the end: `close()`
    // only stops new connections and would otherwise wait on this one forever.
    const accepted: Socket[] = []
    const stalled = createServer((socket) => {
      accepted.push(socket)
    })
    await new Promise<void>((resolve) => stalled.listen(stallSocket, () => resolve()))
    writeFileSync(pidPath, "999999\n", "utf8") // stale: names a dead process

    const claimant = spawn("sleep", ["30"], { stdio: "ignore" })
    try {
      const stopping = stopDaemonProcess(stallSocket, pidPath)
      // Mid-flight: the live host claims the address.
      await new Promise((resolve) => setTimeout(resolve, 200))
      writeFileSync(pidPath, `${claimant.pid}\n`, "utf8")
      const result = await stopping

      expect(result.method).toBe("absent") // it saw only the stale pid
      expect(existsSync(pidPath)).toBe(true) // ...and left the live claim alone
      expect(readFileSync(pidPath, "utf8").trim()).toBe(String(claimant.pid))
    } finally {
      claimant.kill("SIGKILL")
      for (const socket of accepted) socket.destroy()
      await new Promise<void>((resolve) => stalled.close(() => resolve()))
    }
    // The stalled `daemon.stop` burns its full 2s budget by design.
  }, 15_000)

  it("still clears a pidfile whose process is genuinely dead", async () => {
    writeFileSync(pidPath, "999999\n", "utf8")
    await stopDaemonProcess(join(dir, "absent.sock"), pidPath)
    expect(existsSync(pidPath)).toBe(false)
  })
})
