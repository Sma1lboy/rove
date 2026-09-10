/**
 * One `ssh -N -L … -L …` process per machine, kept alive.
 *
 * The two forwards turn the remote daemon socket and the remote PTY-host
 * socket into local unix sockets under `<home>/.rove/machines/<alias>/`. Every
 * other layer then treats a machine exactly like the local daemon — a socket
 * path — which is why nothing above this file knows SSH exists.
 *
 * Windows has no `AF_UNIX` forwarding in OpenSSH's `-L local-socket` form, so
 * {@link startTunnel} reports `unsupported` there rather than spawning
 * something that cannot work. The module still IMPORTS cleanly on Windows —
 * `rove machine list` must run everywhere.
 *
 * Reconnect policy mirrors the daemon client's: exponential backoff capped at
 * a few seconds, forever, because the far side coming back is the expected
 * outcome and a machine the user registered should not need re-registering
 * after a lid close.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { connect as netConnect } from "node:net"
import { homeDir } from "../env.ts"
import type { MachineConfig } from "./registry.ts"
import { localDaemonSocketPath, localPtySocketPath, machineSocketDir, machineSshArgs, tunnelArgs } from "./ssh-args.ts"

/** Owner-only, like every other directory under `<home>/.rove`: the sockets in
 *  here reach a daemon that runs commands as its owner. */
const DIR_MODE = 0o700

export type TunnelState = "connecting" | "online" | "offline" | "unsupported"

export interface TunnelHandle {
  readonly alias: string
  /** Local socket the machine's daemon answers on. */
  readonly daemonSocketPath: string
  /** Local socket the machine's PTY host answers on (PR 2 attaches to it). */
  readonly ptySocketPath: string
  state(): TunnelState
  /** Called on every state transition, including the initial connect. */
  onState(listener: (state: TunnelState) => void): () => void
  stop(): void
}

export interface StartTunnelOptions {
  readonly alias: string
  readonly config: MachineConfig
  readonly remoteDaemonSocket: string
  readonly remotePtySocket: string
  readonly home?: string
  /** Injected for tests: spawn the ssh child. */
  readonly spawnFn?: (argv: readonly string[]) => ChildProcess
  /** Injected for tests: schedule the next reconnect attempt. */
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown
}

const BACKOFF_START_MS = 500
const BACKOFF_MAX_MS = 5_000

/**
 * Spawn (and re-spawn) the tunnel. Returns immediately with a handle whose
 * state starts at `connecting`; callers watch {@link TunnelHandle.onState}
 * rather than awaiting, because a machine that is down must not block the
 * ones that are up.
 */
export function startTunnel(opts: StartTunnelOptions): TunnelHandle {
  const home = opts.home ?? homeDir()
  const dir = machineSocketDir(opts.alias, home)
  const daemonSocketPath = localDaemonSocketPath(opts.alias, home)
  const ptySocketPath = localPtySocketPath(opts.alias, home)
  const listeners = new Set<(state: TunnelState) => void>()
  let state: TunnelState = "connecting"
  let child: ChildProcess | null = null
  let stopped = false
  let backoff = BACKOFF_START_MS

  const setState = (next: TunnelState): void => {
    if (state === next) return
    state = next
    for (const listener of listeners) listener(next)
  }

  if (process.platform === "win32") {
    setState("unsupported")
    return {
      alias: opts.alias,
      daemonSocketPath,
      ptySocketPath,
      state: () => state,
      onState: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      stop: () => {},
    }
  }

  const connect = (): void => {
    if (stopped) return
    try {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE })
    } catch {
      /* a home on a filesystem without modes, or already there */
    }
    // ssh REFUSES to bind a local forward socket that already exists — a
    // leftover from a killed tunnel would otherwise make every reconnect fail
    // with `ExitOnForwardFailure` and read as "that machine is permanently
    // down". Only our own two paths, only inside our own directory.
    for (const path of [daemonSocketPath, ptySocketPath]) {
      try {
        rmSync(path, { force: true })
      } catch {
        /* nothing there */
      }
    }
    const argv = tunnelArgs({
      alias: opts.alias,
      config: opts.config,
      remoteDaemonSocket: opts.remoteDaemonSocket,
      remotePtySocket: opts.remotePtySocket,
      home,
    })
    const spawnFn = opts.spawnFn ?? ((a: readonly string[]) => spawn(a[0] ?? "ssh", a.slice(1), { stdio: "ignore" }))
    let proc: ChildProcess
    try {
      proc = spawnFn(argv)
    } catch {
      scheduleRetry()
      return
    }
    child = proc
    // `ssh -N` prints nothing on success, so there is no "ready" line to wait
    // for. Staying up past the moment ssh would have failed IS the readiness
    // signal: `ExitOnForwardFailure=yes` makes a bind failure an immediate
    // exit, so a process still alive after the grace window has both forwards.
    const readyTimer = setTimeout(() => {
      if (child === proc && !stopped) {
        backoff = BACKOFF_START_MS
        setState("online")
      }
    }, 700)
    proc.on("exit", () => {
      clearTimeout(readyTimer)
      if (child !== proc || stopped) return
      child = null
      setState("offline")
      scheduleRetry()
    })
    proc.on("error", () => {
      clearTimeout(readyTimer)
      if (child !== proc || stopped) return
      child = null
      setState("offline")
      scheduleRetry()
    })
  }

  const scheduleRetry = (): void => {
    if (stopped) return
    const wait = backoff
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    const schedule = opts.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
    schedule(() => connect(), wait)
  }

  connect()

  return {
    alias: opts.alias,
    daemonSocketPath,
    ptySocketPath,
    state: () => state,
    onState: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop: () => {
      stopped = true
      child?.kill("SIGTERM")
      child = null
      setState("offline")
    },
  }
}

/**
 * Install the two forwards onto the machine's SHARED ssh connection, without
 * leaving a process behind — the CLI's way in.
 *
 * A `rove api` process lives for milliseconds, so it cannot hold an `ssh -N`
 * open the way the TUI does. `ssh -O forward` adds a forward to a running
 * ControlMaster instead, and the master outlives the client that created it by
 * `ControlPersist` seconds. So the first CLI call that needs a machine pays
 * one connect, and the next few minutes of calls find the socket already there.
 *
 * Best-effort: every failure answers `false`, and the caller reports the
 * machine as offline. Returns true when the forwarded daemon socket exists
 * afterwards, which is the only claim worth making.
 */
export async function ensureForwards(args: {
  readonly alias: string
  readonly config: MachineConfig
  readonly remoteDaemonSocket: string
  readonly remotePtySocket: string
  readonly home?: string
}): Promise<boolean> {
  if (process.platform === "win32") return false
  const home = args.home ?? homeDir()
  const daemonLocal = localDaemonSocketPath(args.alias, home)
  const ptyLocal = localPtySocketPath(args.alias, home)
  try {
    mkdirSync(machineSocketDir(args.alias, home), { recursive: true, mode: DIR_MODE })
  } catch {
    /* already there */
  }
  if (await socketAnswers(daemonLocal)) return true
  // A leftover socket file from a dead master would make `-O forward` fail.
  for (const path of [daemonLocal, ptyLocal]) {
    try {
      rmSync(path, { force: true })
    } catch {
      /* nothing there */
    }
  }
  const base = machineSshArgs(args.alias, args.config, { home })
  // `true` is the cheapest remote command that establishes the master.
  if ((await runSsh([...base, "true"])) !== 0) return false
  const target = base.at(-1) ?? args.alias
  const flags = base.slice(0, -1)
  const forwarded = await runSsh([
    ...flags,
    "-O",
    "forward",
    "-L",
    `${daemonLocal}:${args.remoteDaemonSocket}`,
    "-L",
    `${ptyLocal}:${args.remotePtySocket}`,
    target,
  ])
  return forwarded === 0 && (await socketAnswers(daemonLocal))
}

function runSsh(argv: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(argv[0] ?? "ssh", argv.slice(1), { stdio: "ignore" })
    child.on("error", () => resolve(-1))
    child.on("close", (code) => resolve(code ?? -1))
  })
}

/** Whether a unix socket at `path` accepts a connection right now. */
function socketAnswers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect(path)
    const done = (answer: boolean): void => {
      socket.destroy()
      resolve(answer)
    }
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
    socket.setTimeout(1500, () => done(false))
  })
}
