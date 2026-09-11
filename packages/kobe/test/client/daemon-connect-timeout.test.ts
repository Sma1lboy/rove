/**
 * The connect deadline on `KobeDaemonClient.openSocket`.
 *
 * `net.connect` has no connect timeout of its own, and the address the PTY
 * host listens on under Windows is a NAMED PIPE (`\\.\pipe\kobe-…`, see
 * `daemon/paths.ts` `windowsPipePath`). A pipe whose instances are all taken
 * does not refuse the connect: libuv parks it in
 * `WaitNamedPipeW(name, 30000)` and retries for as long as it stays busy
 * (libuv `src/win/pipe.c`, `pipe_connect_thread_proc`), so the promise is
 * still pending after 30s — and again after the next 30s. Every caller above
 * it, `ensurePtyHostReachable`'s first probe included, waits with no output.
 * That was reported as "rove will not open a session on Windows".
 *
 * A POSIX runner cannot produce that hang — a dead unix-socket path answers
 * ENOENT at once — so the connect is mocked as one that never settles. The
 * mock is the point: what is under test is that the deadline settles the
 * promise, not how the OS misbehaves.
 */

import { ConnectTimeoutError, KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { probeDaemonSocket } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:net", async (importActual) => {
  const actual = await importActual<typeof import("node:net")>()
  const { EventEmitter } = await import("node:events")
  return {
    ...actual,
    // A socket that emits neither "connect" nor "error": exactly the pending
    // forever state libuv leaves a busy-pipe connect in.
    connect: () => {
      const socket = Object.assign(new EventEmitter(), {
        destroyed: false,
        destroy() {
          this.destroyed = true
        },
        end() {
          this.destroyed = true
        },
        write: () => true,
      })
      return socket
    },
  }
})

const PIPE = "\\\\.\\pipe\\kobe-test-busy"
const clients: KobeDaemonClient[] = []

const open = (path = PIPE): KobeDaemonClient => {
  const client = new KobeDaemonClient(path)
  clients.push(client)
  return client
}

beforeEach(() => {
  process.env.ROVE_CONNECT_TIMEOUT_MS = "120"
})

afterEach(() => {
  process.env.ROVE_CONNECT_TIMEOUT_MS = ""
  for (const client of clients.splice(0)) client.close()
})

describe("connect deadline", () => {
  it("rejects with the address and the budget instead of waiting forever", async () => {
    const started = Date.now()
    const err = await open()
      .connect()
      .then(
        () => null,
        (thrown: unknown) => thrown as Error,
      )

    expect(err).toBeInstanceOf(ConnectTimeoutError)
    expect(err?.name).toBe("ConnectTimeoutError")
    // The message has to say WHAT it waited on and WHERE, or the failure is
    // indistinguishable from every other connect error.
    expect(err?.message).toContain(PIPE)
    expect(err?.message).toContain("120ms")
    // And it must actually settle in the budget, not after some longer wait.
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it("reports the unreachable host as absent, so the caller stops and spawns one", async () => {
    // The load-bearing half: the timeout must land in the same `absent`
    // verdict a refused connect gets, or `ensureDaemonReachable` would treat
    // a hung address as a wedged daemon and refuse to recover from it.
    expect(await probeDaemonSocket(PIPE, 500)).toBe("absent")
  })

  it("keeps a client that gave up reusable — the next connect is not poisoned", async () => {
    const client = open()
    await client.connect().catch(() => {})
    await expect(client.connect()).rejects.toBeInstanceOf(ConnectTimeoutError)
  })

  it("can be disabled, for an operator who wants the old unbounded wait", async () => {
    // 0/negative means no deadline, mirroring `ROVE_RPC_TIMEOUT_MS`. Asserted
    // by a connect that is still pending past the point a deadline would have
    // fired — never by waiting out a hang.
    process.env.ROVE_CONNECT_TIMEOUT_MS = "0"
    const settled = await Promise.race([
      open()
        .connect()
        .then(
          () => "connected",
          () => "rejected",
        ),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 300)),
    ])
    expect(settled).toBe("pending")
  })
})
