/**
 * The session-job work is Windows-only. Pinned here: on macOS and Linux a
 * detached launch is exactly the old one — `detached: true`, the caller's env,
 * no PTY host round trip — even when the env carries a job claim, and the
 * PTY host refuses `spawn.detached`.
 */

import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

const spawned: { command: string; args: readonly string[]; options: Record<string, unknown> }[] = []
const clients: string[] = []

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options })
      const child = new EventEmitter() as ChildProcess
      child.unref = () => child
      return child
    },
  }
})

vi.mock("../../../rove-daemon/src/client/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../rove-daemon/src/client/index.ts")>()
  return {
    ...actual,
    RoveDaemonClient: class {
      constructor(socketPath: string) {
        clients.push(socketPath)
      }
      request() {
        return Promise.resolve({})
      }
      close() {}
    },
  }
})

const { spawnDetachedDaemon } = await import("../../../rove-daemon/src/client/detached-spawn.ts")
const { dispatchPtyRequest } = await import("../../../rove-daemon/src/daemon/pty-server-verbs.ts")
const { PTY_JOB_ENV, PTY_JOB_OWNER_ENV } = await import("../../../rove-daemon/src/daemon/win-pty-job.ts")
const { defaultDaemonSocketPath } = await import("../../../rove-daemon/src/daemon/paths.ts")

afterEach(() => {
  spawned.length = 0
  clients.length = 0
})

for (const platform of ["darwin", "linux"] as const) {
  describe(`on ${platform}`, () => {
    it("launches with setsid and the caller's env, never through the PTY host — even inside a job claim", () => {
      // An env that WOULD be an escape on Windows: this instance's own socket.
      const env = {
        PATH: "/usr/bin",
        [PTY_JOB_ENV]: "Local\\rove-pty-x",
        [PTY_JOB_OWNER_ENV]: defaultDaemonSocketPath(),
      }
      spawnDetachedDaemon("/usr/bin/bun", ["daemon"], env, "/nonexistent-dir/daemon.log", platform)

      expect(clients).toEqual([])
      expect(spawned).toHaveLength(1)
      expect(spawned[0]?.command).toBe("/usr/bin/bun")
      expect(spawned[0]?.options).toMatchObject({ detached: true, env })
    })

    it("has the PTY host refuse spawn.detached", () => {
      const real = process.platform
      Object.defineProperty(process, "platform", { value: platform })
      try {
        expect(() =>
          dispatchPtyRequest(
            {
              type: "request",
              id: "1",
              name: "spawn.detached",
              payload: { command: "/bin/sh", args: [], env: {}, logPath: "/tmp/x" },
            },
            {} as never,
            { ptys: {} as never, writeFrame() {}, requestStop() {} },
          ),
        ).toThrow(/Windows-only/)
        expect(spawned).toEqual([])
      } finally {
        Object.defineProperty(process, "platform", { value: real })
      }
    })
  })
}

describe("on win32", () => {
  it("still launches through the detached launcher outside any session", () => {
    spawnDetachedDaemon("C:\\bun.exe", ["daemon"], { PATH: "x" }, "C:\\nonexistent\\daemon.log", "win32")
    expect(clients).toEqual([])
    expect(spawned[0]?.command).toMatch(/powershell(\.exe)?$/i)
  })

  it("hands a same-instance launch from inside a tab to the PTY host", () => {
    const env = { PATH: "x", [PTY_JOB_ENV]: "Local\\rove-pty-x", [PTY_JOB_OWNER_ENV]: defaultDaemonSocketPath() }
    spawnDetachedDaemon("C:\\bun.exe", ["daemon"], env, "C:\\nonexistent\\daemon.log", "win32")
    expect(clients).toHaveLength(1)
    expect(spawned).toEqual([])
  })

  it("keeps a nested instance's launch on the launcher, so it lands in the tab's job", () => {
    const env = { PATH: "x", [PTY_JOB_ENV]: "Local\\rove-pty-x", [PTY_JOB_OWNER_ENV]: "C:\\elsewhere\\daemon.sock" }
    spawnDetachedDaemon("C:\\bun.exe", ["daemon"], env, "C:\\nonexistent\\daemon.log", "win32")
    expect(clients).toEqual([])
    expect(spawned[0]?.command).toMatch(/powershell(\.exe)?$/i)
  })
})
