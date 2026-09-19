/**
 * `pty.kill { wait: true }` — the reply is the child's EXIT, not the
 * acknowledgement.
 *
 * A task deletion asks for this before it runs `git worktree remove`: the
 * plain verb answers `accepted` while the child is still exiting, and a
 * process whose cwd is inside the worktree keeps that directory undeletable
 * on Windows. The dispatch loop is otherwise synchronous, so this is also
 * the one place a promise-shaped reply has to be awaited by the server
 * rather than serialised as `{}`.
 *
 * The socket is a named pipe on Windows: a unix socket under `%TEMP%` cannot
 * be listened on there (`EACCES`), which is why the sibling restart test
 * never runs on a Windows box.
 */

import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import type { PtyChild, PtyDriver, PtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-driver"
import { type PtyHostServer, startPtyHostServer } from "@sma1lboy/kobe-daemon/daemon/pty-server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let dir: string
let socketPath: string
let savedHome: string | undefined
const servers: PtyHostServer[] = []
const clients: KobeDaemonClient[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kobe-pty-kill-wait-"))
  socketPath = process.platform === "win32" ? `\\\\.\\pipe\\kobe-pty-kill-wait-${randomUUID()}` : join(dir, "pty.sock")
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

/**
 * A child that takes a while to die: the first signal starts a timer, the
 * exit lands `EXIT_DELAY_MS` later. `pid = 1` so `signalProcessGroup` never
 * reaches for a real process group (it only does for `pid > 1`).
 */
const EXIT_DELAY_MS = 150
class SlowChild implements PtyChild {
  readonly pid = 1
  private settle!: (exit: PtyExit) => void
  readonly exited = new Promise<PtyExit>((resolve) => {
    this.settle = resolve
  })
  private dying = false
  static exits: number[] = []
  write(): void {}
  resize(): void {}
  close(): void {}
  kill(signal: NodeJS.Signals): void {
    if (this.dying) return
    this.dying = true
    setTimeout(() => {
      SlowChild.exits.push(Date.now())
      this.settle({ code: null, signal })
    }, EXIT_DELAY_MS)
  }
}

const slowDriver: PtyDriver = () => new SlowChild()

async function bootHost(): Promise<PtyHostServer> {
  const server = await startPtyHostServer({
    socketPath,
    pidPath: join(dir, "pty.pid"),
    freezeDir: join(dir, "pty-sessions"),
    driver: slowDriver,
    idleExitMs: 60_000,
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

describe("pty.kill with wait", () => {
  it("answers only once the child has exited, and says so", async () => {
    await bootHost()
    const client = await connect()
    await client.request("pty.open", { key: "t1::tab-1", cwd: "/wt/t1", command: ["/bin/cat"] })

    SlowChild.exits = []
    const before = Date.now()
    const reply = await client.request("pty.kill", { key: "t1::tab-1", wait: true })
    // The reply carried the exit: it arrived after the child's own delay,
    // and the exit had landed by then.
    expect(reply).toEqual({ accepted: true, ended: true })
    expect(Date.now() - before).toBeGreaterThanOrEqual(EXIT_DELAY_MS - 5)
    expect(SlowChild.exits).toHaveLength(1)
    const listed = await client.request<{ sessions: { key: string }[] }>("pty.list", {})
    expect(listed.sessions).toEqual([])
  })

  it("the plain verb still answers before the exit — the acknowledgement it always was", async () => {
    await bootHost()
    const client = await connect()
    await client.request("pty.open", { key: "t2::tab-1", cwd: "/wt/t2", command: ["/bin/cat"] })

    SlowChild.exits = []
    const reply = await client.request("pty.kill", { key: "t2::tab-1" })
    expect(reply).toEqual({ accepted: true })
    // Still dying when the reply came back.
    expect(SlowChild.exits).toHaveLength(0)
  })

  it("waiting on a key the host does not hold answers at once", async () => {
    await bootHost()
    const client = await connect()
    const reply = await client.request("pty.kill", { key: "never::opened", wait: true })
    expect(reply).toEqual({ accepted: true, ended: true })
  })
})
