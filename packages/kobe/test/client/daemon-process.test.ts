import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import { type Server, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ensureDaemonReachable,
  probeDaemonSocket,
  resolveKobeSpawn,
  testDaemonResponds,
  tryAcquireSpawnLock,
} from "@sma1lboy/kobe-daemon/client/daemon-process"
import { isProcessAlive } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import { afterEach, describe, expect, it } from "vitest"

// Short paths: macOS caps unix-socket paths at ~104 chars, and tmpdir() can
// be long, so anchor under /tmp where available.
const SOCK_DIR = process.platform === "darwin" ? "/tmp" : tmpdir()
const servers: Server[] = []
const openSockets = new Set<import("node:net").Socket>()
type EventedServer = Server & { once(event: "error", listener: (err: Error) => void): void }

describe("resolveKobeSpawn", () => {
  it("re-enters through the active public wrapper in source mode", () => {
    expect(resolveKobeSpawn(["daemon", "start"], { ROVE_INVOKED_AS: "rove" })).toEqual([
      process.execPath,
      expect.stringMatching(/\/cli\/rove\.ts$/),
      "daemon",
      "start",
    ])
    expect(resolveKobeSpawn(["daemon", "start"], { ROVE_INVOKED_AS: "kobe" })).toEqual([
      process.execPath,
      expect.stringMatching(/\/cli\/kobe\.ts$/),
      "daemon",
      "start",
    ])
  })
})

function listenAt(path: string, handler?: (sock: import("node:net").Socket) => void): Promise<string> {
  try {
    unlinkSync(path)
  } catch {
    /* no stale socket — fine */
  }
  // Track server-side connections so afterEach can destroy them — a wedged
  // server never closes its socket, so `server.close()` would otherwise hang.
  const server = createServer((sock) => {
    openSockets.add(sock)
    sock.on("close", () => openSockets.delete(sock))
    handler?.(sock)
  })
  servers.push(server)
  return new Promise((resolve, reject) => {
    ;(server as EventedServer).once("error", reject)
    server.listen(path, () => resolve(path))
  })
}

function listen(handler?: (sock: import("node:net").Socket) => void): Promise<string> {
  return listenAt(join(SOCK_DIR, `kobe-dpr-${process.pid}-${servers.length}.sock`), handler)
}

/** Minimal daemon stand-in: answers `hello` and nothing else. */
function helloResponder(sock: import("node:net").Socket): void {
  sock.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      const frame = JSON.parse(line) as { id: string; name: string }
      if (frame.name === "hello") {
        sock.write(`${JSON.stringify({ type: "response", id: frame.id, payload: { protocolVersion: 2 } })}\n`)
      }
    }
  })
}

afterEach(async () => {
  for (const sock of openSockets) sock.destroy()
  openSockets.clear()
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
})

describe("testDaemonResponds", () => {
  it("is true when the daemon answers hello", async () => {
    const path = await listen(helloResponder)
    expect(await testDaemonResponds(path, 1000)).toBe(true)
  })

  it("is false for a wedged daemon — accepts the socket but never replies", async () => {
    const path = await listen(() => {
      /* accept the connection and ignore it: the wedge we must detect */
    })
    expect(await testDaemonResponds(path, 300)).toBe(false)
  })

  // KNOWN GAP, pinned deliberately as the behavior that ships today rather
  // than as a wish. `probeDaemonSocket` treats a hello that REJECTS the same
  // as one that resolves (`.catch(() => true)`), so a daemon that accepts the
  // connection and then drops it reads as "alive". A daemon in its shutdown
  // path does exactly that — `daemon.stopping` destroys every client socket —
  // so a client probing during that window is told the daemon is fine and
  // returns a socket that is about to disappear. Change the verdict to
  // "absent" and this expectation is what tells you the contract moved.
  it("counts a connection dropped mid-hello as alive", async () => {
    const path = await listen((sock) => {
      setTimeout(() => sock.destroy(), 50)
    })
    expect(await probeDaemonSocket(path, 1000)).toBe("alive")
  })

  it("is false when no daemon is listening", async () => {
    expect(await testDaemonResponds(join(SOCK_DIR, `kobe-dpr-absent-${process.pid}.sock`), 300)).toBe(false)
  })
})

describe("tryAcquireSpawnLock", () => {
  it("acquires on a fresh home whose .kobe dir does not exist yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-spawn-lock-"))
    try {
      const lock = join(dir, "does-not-exist-yet", ".kobe", "daemon.pid.spawn-lock")
      expect(tryAcquireSpawnLock(lock)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("second acquire loses while the lock is fresh", () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-spawn-lock-"))
    try {
      const lock = join(dir, "daemon.pid.spawn-lock")
      expect(tryAcquireSpawnLock(lock)).toBe(true)
      expect(tryAcquireSpawnLock(lock)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reclaims a stale lock left by a crashed spawner", () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-spawn-lock-"))
    try {
      const lock = join(dir, "daemon.pid.spawn-lock")
      expect(tryAcquireSpawnLock(lock)).toBe(true)
      const past = new Date(Date.now() - 60_000)
      utimesSync(lock, past, past)
      expect(tryAcquireSpawnLock(lock)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * Point BOTH env namespaces at the test's throwaway paths, and hand back a
 * restore function. Writing only `KOBE_*` is not isolation: `readRoveEnv`
 * prefers `ROVE_*`, so an inherited `ROVE_DAEMON_SOCKET_PATH` would quietly
 * aim these tests at the developer's real daemon. `undefined` clears a pair,
 * which is how a test escapes `insideEngineSession()` — this suite itself
 * normally runs inside a Rove engine tab, where the task id is set.
 */
function overrideRoveEnv(vars: Record<string, string | undefined>): () => void {
  const saved: [string, string | undefined][] = []
  for (const [suffix, value] of Object.entries(vars)) {
    for (const name of [`ROVE_${suffix}`, `KOBE_${suffix}`]) {
      saved.push([name, process.env[name]])
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
  }
}

describe("ensureDaemonReachable under a held spawn lock", () => {
  it("waits for the winner's daemon instead of stacking a second stop+spawn", async () => {
    // Two clients race after the same daemon drop (the 2026-08-11 twin
    // autospawn). The loser must NOT kill/spawn — it polls until the
    // winner's daemon answers, and never releases the winner's lock.
    const dir = mkdtempSync(join(tmpdir(), "kobe-spawn-wait-"))
    const socketPath = join(SOCK_DIR, `kobe-dpr-wait-${process.pid}.sock`)
    const restoreEnv = overrideRoveEnv({
      DAEMON_SOCKET_PATH: socketPath,
      DAEMON_PID_PATH: join(dir, "daemon.pid"),
      HOME_DIR: dir,
    })
    const lock = join(dir, "daemon.pid.spawn-lock")
    writeFileSync(lock, "")
    try {
      // The "winner" brings its daemon up a beat later.
      const timer = setTimeout(() => {
        void listenAt(socketPath, helloResponder)
      }, 300)
      const resolved = await ensureDaemonReachable()
      clearTimeout(timer)
      expect(resolved).toBe(socketPath)
      // Still the winner's lock — the waiter neither spawned nor released it.
      expect(existsSync(lock)).toBe(true)
    } finally {
      restoreEnv()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * A daemon stand-in that is BUSY rather than broken: it accepts connections
 * and records every request name it is asked for, but stays silent for the
 * first `silentConnections` clients — long enough to blow the hello deadline
 * twice — before answering `hello` normally, like a daemon that has caught
 * up on its backlog.
 *
 * Silence is per-connection and decided when the connection opens, so the
 * handover is driven by the client's own probe sequence rather than by a
 * timer. It must never DESTROY a connection to simulate the wedge: the
 * client counts a mid-flight close as a reply (`.catch(() => true)`), which
 * reports a silent daemon as "alive" and skips the code under test entirely.
 */
function busyThenHealthy(silentConnections: number, seen: string[]) {
  let connections = 0
  return (sock: import("node:net").Socket): void => {
    connections += 1
    const answering = connections > silentConnections
    sock.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        const frame = JSON.parse(line) as { id: string; name: string }
        seen.push(frame.name)
        if (answering && frame.name === "hello") {
          sock.write(`${JSON.stringify({ type: "response", id: frame.id, payload: { protocolVersion: 2 } })}\n`)
        }
      }
    })
  }
}

describe("ensureDaemonReachable when the daemon is busy, not dead", () => {
  it("waits out a live-but-slow daemon instead of stopping it", async () => {
    // The 2026-08-29 succession storm: a busy daemon misses the hello
    // deadline, the client concludes it is dead and kills it, the
    // replacement's arrival makes the old one self-stop, every client
    // reconnects at once onto a cold-starting daemon, repeat — eleven
    // successions in fifty minutes.
    //
    // What must hold is an ACTION, not a duration: a daemon whose PROCESS is
    // alive must not be stopped merely for being slow. So the stand-in is a
    // real live process plus a socket that logs what it is asked for, and
    // both halves of "we did not kill it" are asserted directly —
    // `daemon.stop` was never sent, and the process is still running after.
    //
    // Two earlier versions asserted proxies and stayed green with the fix
    // deleted, so both traps are pinned here: a pidfile naming THIS process
    // is skipped by the guard (`livePid !== process.pid`) AND by
    // `stopDaemonProcess`, leaving nothing at risk; and destroying the
    // probe's own connection makes `probeDaemonSocket` read the close as a
    // reply and return "alive", so the branch under test is never entered.
    const dir = mkdtempSync(join(tmpdir(), "kobe-busy-daemon-"))
    const socketPath = join(SOCK_DIR, `kobe-dpr-busy-${process.pid}.sock`)
    const pidPath = join(dir, "daemon.pid")
    const restoreEnv = overrideRoveEnv({
      DAEMON_SOCKET_PATH: socketPath,
      DAEMON_PID_PATH: pidPath,
      HOME_DIR: dir,
      // Cleared, or this measures nothing: inside an engine session
      // `ensureDaemonReachable` throws on a wedged socket before it ever
      // reaches the liveness check.
      TASK_ID: undefined,
      TAB_ID: undefined,
    })

    // The busy daemon's process. A real child, because the whole question is
    // what the OS says about a pid that is NOT this one.
    const busyDaemon = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" })
    const busyPid = busyDaemon.pid

    // Two silent probes: `ensureDaemonReachable` spends one hello deadline
    // before taking the spawn lock and another re-probing under it. The
    // third client is whoever runs next — the grace-window poll if the
    // daemon is given one, `stopDaemonProcess` if it is not.
    const seen: string[] = []
    await listenAt(socketPath, busyThenHealthy(2, seen))

    try {
      expect(busyPid).toBeGreaterThan(0)
      writeFileSync(pidPath, String(busyPid))

      // Capture rather than propagate, so the invariant below is what
      // reports the failure. Letting the throw escape here would surface as
      // "daemon did not start" — the downstream symptom of having killed the
      // daemon, which names neither the rule that was broken nor this bug.
      const outcome = await ensureDaemonReachable().then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      )

      // THE invariant: a daemon whose process is alive is never stopped for
      // being slow. `stopDaemonProcess` opens with a `daemon.stop` RPC, so
      // one appearing in the log means the client decided this daemon was
      // dead. The grace window only ever sends `hello`.
      expect(seen).not.toContain("daemon.stop")
      // Still running, and still owning its pidfile — `stopDaemonProcess`
      // signals the process and unlinks both files on its way out, so these
      // are two further independent reads of "we did not kill it".
      expect(isProcessAlive(busyPid as number)).toBe(true)
      expect(existsSync(pidPath)).toBe(true)

      // And the wait actually paid off: the caller gets the busy daemon's
      // own socket back, not an error and not a replacement's.
      expect(outcome.error).toBeUndefined()
      expect(outcome.value).toBe(socketPath)
    } finally {
      busyDaemon.kill("SIGKILL")
      restoreEnv()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
