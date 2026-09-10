/**
 * The SSH forward that makes a machine's daemon reachable as a local socket.
 *
 * Both forwards ride the machine's shared ControlMaster connection
 * (`ssh -O forward`), which outlives the process that created it by
 * `ControlPersist` seconds. That is what lets a millisecond-long `rove api`
 * process and a day-long TUI use the SAME mechanism: neither has to hold an
 * `ssh -N` open, and neither can knock the other's forward down by racing it
 * for the same socket path — which is exactly what happened while the two were
 * separate.
 *
 * So {@link ensureForwards} is the whole transport, and {@link startTunnel} is
 * that plus a liveness poll: it re-establishes the forward when the socket
 * stops answering, with exponential backoff, forever. The far side coming back
 * is the expected outcome — a machine you registered should not need
 * re-registering after a lid close.
 *
 * Windows has no `AF_UNIX` forwarding in OpenSSH's `-L local-socket` form, so
 * both entry points report failure there rather than pretending. The module
 * still IMPORTS cleanly on Windows — `rove machine list` must run everywhere.
 */

import { spawn } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { connect as netConnect } from "node:net"
import { homeDir } from "../env.ts"
import type { MachineConfig } from "./registry.ts"
import { localDaemonSocketPath, localPtySocketPath, machineSocketDir, machineSshArgs } from "./ssh-args.ts"

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
  /** Injected for tests: bring the forward up. Resolves true when it is up. */
  readonly ensureFn?: () => Promise<boolean>
  /** Injected for tests: whether the forwarded daemon socket answers. */
  readonly checkFn?: () => Promise<boolean>
  /** Injected for tests: schedule the next attempt / health check. */
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown
}

const BACKOFF_START_MS = 500
const BACKOFF_MAX_MS = 5_000
/** How often a live forward is re-checked. Long enough to be free, short
 *  enough that a closed lid greys its rows within one glance. */
const HEALTH_INTERVAL_MS = 10_000

/**
 * Keep a machine's forward up. Returns immediately with a handle whose state
 * starts at `connecting`; callers watch {@link TunnelHandle.onState} rather
 * than awaiting, because a machine that is down must not block the ones that
 * are up.
 */
export function startTunnel(opts: StartTunnelOptions): TunnelHandle {
  const home = opts.home ?? homeDir()
  const daemonSocketPath = localDaemonSocketPath(opts.alias, home)
  const ptySocketPath = localPtySocketPath(opts.alias, home)
  const listeners = new Set<(state: TunnelState) => void>()
  let state: TunnelState = "connecting"
  let stopped = false
  let backoff = BACKOFF_START_MS

  const setState = (next: TunnelState): void => {
    if (state === next) return
    state = next
    for (const listener of listeners) listener(next)
  }
  const handle: TunnelHandle = {
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
    },
  }

  if (process.platform === "win32") {
    setState("unsupported")
    return handle
  }

  const schedule = opts.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const ensure =
    opts.ensureFn ??
    (() =>
      ensureForwards({
        alias: opts.alias,
        config: opts.config,
        remoteDaemonSocket: opts.remoteDaemonSocket,
        remotePtySocket: opts.remotePtySocket,
        home,
      }))
  const check = opts.checkFn ?? (() => socketAnswers(daemonSocketPath))

  const attempt = async (): Promise<void> => {
    if (stopped) return
    const up = await ensure()
    if (stopped) return
    if (up) {
      backoff = BACKOFF_START_MS
      setState("online")
      schedule(() => void health(), HEALTH_INTERVAL_MS)
      return
    }
    setState("offline")
    const wait = backoff
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    schedule(() => void attempt(), wait)
  }

  const health = async (): Promise<void> => {
    if (stopped) return
    if (await check()) {
      if (!stopped) schedule(() => void health(), HEALTH_INTERVAL_MS)
      return
    }
    // The forward went away — the master timed out, the network dropped, or
    // the machine went to sleep. Rows stay on screen and grey out; this side
    // just starts trying again.
    setState("offline")
    void attempt()
  }

  void attempt()
  return handle
}

/**
 * Install both forwards onto the machine's shared ssh connection, leaving no
 * process behind.
 *
 * Best-effort: every failure answers `false`, and the caller reports the
 * machine as offline. Returns true only when the forwarded daemon socket
 * actually answers afterwards, which is the only claim worth making.
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
    /* already there, or a filesystem without modes */
  }
  // Already up — including when another Rove process on this machine put it
  // up. Sharing the forward is the point: a second one on the same path is
  // what `ExitOnForwardFailure` would refuse.
  if (await socketAnswers(daemonLocal)) return true
  // A socket FILE with nothing behind it is a leftover from a dead master;
  // ssh refuses to bind over it. Only our own two paths, in our own directory.
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
