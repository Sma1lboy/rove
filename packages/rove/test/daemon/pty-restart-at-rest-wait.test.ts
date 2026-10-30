/**
 * `pty.killAtRest` answers only after the old child has exited: the caller
 * opens the replacement and resumes the same conversation on that answer, so
 * an old child still flushing through its SIGTERM grace must not overlap it.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { PtyChild, PtyDriver, PtyExit } from "@sma1lboy/rove-daemon/daemon/pty-driver"
import { type PtyHostServer, startPtyHostServer } from "@sma1lboy/rove-daemon/daemon/pty-server"
import { afterEach, beforeEach, expect, it } from "vitest"

let dir: string
let server: PtyHostServer | undefined
let client: RoveDaemonClient | undefined
const procs: ChildProcess[] = []
let reportedIdle = Promise.withResolvers<void>()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rove-pty-restart-wait-"))
  reportedIdle = Promise.withResolvers<void>()
})

afterEach(async () => {
  client?.close()
  await server?.close().catch(() => {})
  for (const proc of procs.splice(0)) if (proc.exitCode === null) proc.kill("SIGKILL")
  rmSync(dir, { recursive: true, force: true })
})

/** A real process in its own group (the host signals `-pid`), piped rather than on a PTY: `Bun` is not a global under vitest. */
const pipedDriver: PtyDriver = ({ argv, cwd, onData }) => {
  const proc = spawn(argv[0] ?? "sh", argv.slice(1), { cwd, detached: true, stdio: ["ignore", "pipe", "ignore"] })
  procs.push(proc)
  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    onData(text)
    // The host parses status inside `onData`, so it has recorded idle by now.
    if (text.includes("state=idle")) reportedIdle.resolve()
  })
  const { promise: exited, resolve } = Promise.withResolvers<PtyExit>()
  proc.once("exit", (code, signal) => resolve({ code, signal }))
  const child: PtyChild = {
    pid: proc.pid ?? 1,
    exited,
    write() {},
    resize() {},
    close() {},
    kill: (signal) => proc.kill(signal),
  }
  return child
}

it.skipIf(process.platform === "win32")("answers only after the old child finished its SIGTERM shutdown", async () => {
  const marker = join(dir, "shutdown-done")
  // A real process with a real shutdown delay (300ms, inside the host's 500ms SIGTERM grace): the overlap needs the real clock.
  const script = `trap 'sleep 0.3; : > "${marker}"; exit 0' TERM; printf '\\033]7501;state=idle\\007'; while :; do sleep 0.05; done`
  server = await startPtyHostServer({
    socketPath: join(dir, "pty.sock"),
    pidPath: join(dir, "pty.pid"),
    freezeDir: join(dir, "pty-sessions"),
    driver: pipedDriver,
    idleExitMs: 60_000,
  })
  client = new RoveDaemonClient(join(dir, "pty.sock"))
  await client.connect()
  const key = "t1::tab-1"
  await client.request("pty.open", { key, cwd: dir, command: ["sh", "-c", script] })

  await reportedIdle.promise
  type Row = { key: string; generation?: string; programStatusEvent?: { revision: number } }
  const row = (await client.request<{ sessions: Row[] }>("pty.list", {})).sessions.find((s) => s.key === key)
  if (!row?.generation || !row.programStatusEvent) throw new Error("child never reported idle")

  const reply = await client.request("pty.killAtRest", {
    key,
    expectedGeneration: row.generation,
    expectedRevision: row.programStatusEvent.revision,
  })
  expect(existsSync(marker)).toBe(true)
  expect(reply).toEqual({ accepted: true, ended: true })
})
