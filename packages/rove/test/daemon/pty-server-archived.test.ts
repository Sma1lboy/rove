/** The PTY host refuses to spawn a session under a task the task index marks archived, whichever client asks. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { PtyChild, PtyDriver } from "@sma1lboy/rove-daemon/daemon/pty-driver"
import { type PtyHostServer, startPtyHostServer } from "@sma1lboy/rove-daemon/daemon/pty-server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let dir: string
let savedHome: string | undefined
let server: PtyHostServer | undefined
let client: RoveDaemonClient | undefined
let spawned: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rove-pty-arch-"))
  savedHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = dir
  spawned = 0
})

afterEach(async () => {
  client?.close()
  await server?.close().catch(() => {})
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
  rmSync(dir, { recursive: true, force: true })
})

const driver: PtyDriver = () => {
  spawned++
  return {
    pid: 3000 + spawned,
    exited: new Promise(() => {}),
    write() {},
    resize() {},
    close() {},
    kill() {},
  } as unknown as PtyChild
}

describe("pty.open under an archived task", () => {
  it("is refused with TASK_ARCHIVED and spawns nothing; a live task still opens", async () => {
    mkdirSync(join(dir, ".rove"), { recursive: true })
    writeFileSync(
      join(dir, ".rove", "tasks.json"),
      JSON.stringify({ version: 1, tasks: [{ id: "arch", archived: true }, { id: "live" }] }),
    )
    server = await startPtyHostServer({
      socketPath: join(dir, "pty.sock"),
      pidPath: join(dir, "pty.pid"),
      freezeDir: join(dir, "pty-sessions"),
      driver,
      idleExitMs: 60_000,
    })
    client = new RoveDaemonClient(join(dir, "pty.sock"))
    await client.connect()
    await expect(client.request("pty.open", { key: "arch::tab-1", cwd: dir, command: ["/bin/cat"] })).rejects.toThrow(
      /TASK_ARCHIVED/,
    )
    expect(spawned).toBe(0)
    await client.request("pty.open", { key: "live::tab-1", cwd: dir, command: ["/bin/cat"] })
    expect(spawned).toBe(1)
  })
})
