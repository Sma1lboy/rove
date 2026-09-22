import { closeSync, existsSync, mkdirSync, openSync, statSync, unlinkSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { LEGACY_KOBE_PRODUCT_NAME, ROVE_PRODUCT_NAME } from "../compat-env.ts"
import { isProcessAlive, stopDaemonProcess } from "../daemon/lifecycle.ts"
import { defaultDaemonLogPath, defaultDaemonPidPath, defaultDaemonSocketPath } from "../daemon/paths.ts"
import { DAEMON_PROTOCOL_VERSION } from "../daemon/protocol.ts"
import { readPidFile } from "../daemon/socket-guard.ts"
import { spawnDetachedDaemon } from "./detached-spawn.ts"
import { KobeDaemonClient } from "./index.ts"

const DAEMON_START_ARGS = ["daemon", "start"] as const

/** Hello timeout before a socket counts as WEDGED. A healthy daemon answers in well under 100ms. */
const DAEMON_HELLO_TIMEOUT_MS = 3000

/**
 * Grace for a daemon whose PROCESS is alive before we call it wedged and kill
 * it. {@link DAEMON_HELLO_TIMEOUT_MS} asks "is it quick"; only this one
 * licenses a kill. Covers a cold-start plugin-host scan plus a burst of
 * concurrent task creation.
 */
const BUSY_DAEMON_GRACE_MS = 15_000

/**
 * True inside an engine session (the launch script exports `KOBE_TASK_ID`).
 * Helpers there must never kill the shared daemon: a busy one looks wedged,
 * and stop-then-spawn would replace it with a session-env clone that steals
 * the socket and leaves a zombie.
 */
function insideEngineSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.KOBE_TASK_ID === "string" && env.KOBE_TASK_ID !== ""
}

/**
 * Env for an AUTOSPAWNED daemon: drops the spawner's engine-session identity
 * (task/tab/TUI markers must not stick to a shared daemon) and sets the
 * autospawn flag the lifetime policy reads (first-gui grace: a spawned daemon
 * no gui ever attaches to reaps itself).
 */
export function autospawnDaemonEnv(
  env: NodeJS.ProcessEnv = process.env,
  reason: DaemonSpawnReason = "autospawn",
): NodeJS.ProcessEnv {
  const {
    KOBE_TASK_ID: _task,
    KOBE_TAB_ID: _tab,
    KOBE_TUI: _tui,
    KOBE_TERMINAL_PTY: _pty,
    ROVE_TASK_ID: _roveTask,
    ROVE_TAB_ID: _roveTab,
    ROVE_TUI: _roveTui,
    ROVE_TERMINAL_PTY: _rovePty,
    ...rest
  } = env
  // The child re-enters through a public wrapper, so stamp both names before
  // that wrapper reapplies ROVE_* precedence.
  return {
    ...rest,
    KOBE_DAEMON_AUTOSPAWNED: "1",
    ROVE_DAEMON_AUTOSPAWNED: "1",
    KOBE_DAEMON_SPAWN_REASON: reason,
    ROVE_DAEMON_SPAWN_REASON: reason,
  }
}

/**
 * How this daemon came to exist, logged on its first line so `daemon.log`
 * tells a `rove daemon restart` apart from a helper's autospawn (both go
 * through {@link ensureDaemonReachable}). Rides the spawn env. `manual` = a
 * hand-typed `rove daemon start`; nothing was stamped.
 */
export type DaemonSpawnReason = "autospawn" | "explicit-restart" | "manual"

/** Read the spawn reason a parent stamped, for the daemon's own boot line. */
export function daemonSpawnReason(env: NodeJS.ProcessEnv = process.env): DaemonSpawnReason {
  const raw = env.ROVE_DAEMON_SPAWN_REASON ?? env.KOBE_DAEMON_SPAWN_REASON
  if (raw === "explicit-restart" || raw === "autospawn") return raw
  // Pre-0.9.158 spawners stamped no reason but did stamp the autospawn flag.
  return env.ROVE_DAEMON_AUTOSPAWNED === "1" || env.KOBE_DAEMON_AUTOSPAWNED === "1" ? "autospawn" : "manual"
}

/**
 * Cross-process autospawn mutex. Clients that find the daemon unreachable at
 * once (a gui plus its helper pane after the same drop) must not each
 * stop+spawn: stacked `stopDaemonProcess` calls SIGKILL each other's fresh
 * daemons and unlink the live socket, which starts split-brain. A `wx`
 * lockfile next to the pidfile serializes them; losers wait for the winner's
 * daemon.
 */
// Both budgets must cover the WINNER's worst case, or losers give up (or
// steal the lock as stale) while it still works:
//   BUSY_DAEMON_GRACE_MS (15s waiting out a busy daemon)
// + stopDaemonProcess escalation (~7s graceful → SIGTERM → SIGKILL)
// + spawn poll (5s)
// ≈ 27s. Stale must exceed wait so a bored peer never robs a working winner.
const SPAWN_LOCK_STALE_MS = 40_000
const SPAWN_LOCK_WAIT_MS = 30_000

/** False when someone else holds a fresh lock; reclaims stale ones. */
export function tryAcquireSpawnLock(lockPath: string, staleMs: number = SPAWN_LOCK_STALE_MS): boolean {
  const create = (): boolean => {
    // A fresh home has no state dir; the ENOENT would read as "lock held"
    // below and stall the very first command.
    mkdirSync(dirname(lockPath), { recursive: true })
    closeSync(openSync(lockPath, "wx"))
    return true
  }
  try {
    return create()
  } catch {
    try {
      if (Date.now() - statSync(lockPath).mtimeMs <= staleMs) return false
      unlinkSync(lockPath)
      return create()
    } catch {
      // Lost the stale-reclaim race: treat as held; the caller's wait loop covers it.
      return false
    }
  }
}

/**
 * No-op when the socket answers; otherwise spawn a detached `daemon start`
 * ({@link autospawnDaemonEnv}) and poll up to 5s. Returns the socket path;
 * throws if the daemon never comes up, or when it is wedged inside an engine
 * session (session helpers never kill the shared daemon).
 */
export async function ensureDaemonReachable(
  /** Test seam: a stale install can't otherwise be reproduced without deleting the source tree. */
  resolveSpawn: (subcommand: readonly string[]) => string[] = resolveKobeSpawn,
  /** Stamped into the spawned daemon's env so its boot line says who asked. */
  spawnReason: DaemonSpawnReason = "autospawn",
): Promise<string> {
  const socketPath = defaultDaemonSocketPath()
  const state = await probeDaemonSocket(socketPath)
  if (state === "alive") return socketPath

  if (state === "wedged" && insideEngineSession()) {
    // Busy and wedged look the same from here, and a session helper killing
    // the shared daemon starts split-brain. Leave recovery to a human path.
    throw new Error(
      `rove: daemon at ${socketPath} is not answering hello (busy or wedged); not restarting it from inside an engine session — retry, or run \`rove daemon restart\` from a regular shell`,
    )
  }

  const lockPath = `${defaultDaemonPidPath()}.spawn-lock`
  if (!tryAcquireSpawnLock(lockPath)) {
    // Another client is mid stop+spawn; wait for ITS daemon.
    const deadline = Date.now() + SPAWN_LOCK_WAIT_MS
    while (Date.now() < deadline) {
      if (await testDaemonResponds(socketPath)) return socketPath
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 150))
    }
    throw new Error(
      `rove: another process is starting the daemon but it never became reachable at ${socketPath}; check ${defaultDaemonLogPath()} or run \`rove doctor\``,
    )
  }
  try {
    // Re-probe: the previous holder may have brought a daemon up meanwhile.
    if ((await probeDaemonSocket(socketPath)) === "alive") return socketPath

    // A SLOW HELLO IS NOT A DEAD DAEMON (spawning a few tasks at once can
    // miss the hello timeout). Killing it feeds a succession storm:
    //
    //   busy daemon misses hello → client kills it and unlinks the socket →
    //   spawns a replacement → the displaced daemon's ownership guard sees a
    //   different inode and self-stops → every client's connection drops →
    //   each GUI reconnects with ZERO delay → they all probe a daemon that
    //   is now cold-starting → it misses hello → repeat.
    //
    // The spawn lock only serializes the killing. So ask the OS: a live pid
    // (`kill(pid, 0)`) means busy, not wedged; back off. Only an absent or
    // unreadable pidfile justifies stop+spawn.
    const livePid = await readPidFile(defaultDaemonPidPath())
    if (livePid !== null && livePid !== process.pid && isProcessAlive(livePid)) {
      const deadline = Date.now() + BUSY_DAEMON_GRACE_MS
      while (Date.now() < deadline) {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 250))
        if (await testDaemonResponds(socketPath)) return socketPath
        // Died on its own while we waited: stop+spawn below is now correct.
        if (!isProcessAlive(livePid)) break
      }
      // Alive and silent past the grace window: genuinely wedged; escalate below.
    }

    // Resolve argv BEFORE tearing down: on a stale install this throws having
    // touched nothing, instead of killing a working daemon with no replacement.
    const [command, ...args] = resolveSpawn(DAEMON_START_ARGS)

    // Stop first (idempotent; clears stale socket/pidfile) so the fresh spawn
    // can't race a still-alive wedged daemon onto the same tasks.json.
    await stopDaemonProcess(socketPath, defaultDaemonPidPath()).catch(() => {})
    spawnDetachedDaemon(command, args, autospawnDaemonEnv(process.env, spawnReason), defaultDaemonLogPath())

    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (await testDaemonResponds(socketPath)) return socketPath
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 100))
    }
    throw new Error(
      `rove: daemon did not start (or stayed wedged) at ${socketPath}; check ${defaultDaemonLogPath()} or run \`rove doctor\``,
    )
  } finally {
    try {
      unlinkSync(lockPath)
    } catch {
      /* already reclaimed as stale by a peer — fine */
    }
  }
}

export async function connectOrStartDaemon(spawnReason: DaemonSpawnReason = "autospawn"): Promise<KobeDaemonClient> {
  const socketPath = await ensureDaemonReachable(resolveKobeSpawn, spawnReason)
  const client = new KobeDaemonClient(socketPath)
  await client.connect()
  return client
}

/** Connect only to an already-responsive daemon, never spawn; `null` when absent or wedged. */
export async function connectIfRunning(): Promise<KobeDaemonClient | null> {
  const socketPath = defaultDaemonSocketPath()
  if (!(await testDaemonResponds(socketPath))) return null
  const client = new KobeDaemonClient(socketPath)
  await client.connect()
  return client
}

/** What a socket probe found: answering, nothing usable there, or a socket
 *  that connects but won't answer hello (busy past the timeout, or hung). */
export type DaemonSocketState = "alive" | "absent" | "wedged"

/**
 * Does the daemon at `socketPath` connect and answer `hello` within `timeoutMs`?
 *
 *  - `alive`: it ANSWERED. Any frame counts, including a version-mismatch
 *    error; the caller's real connect owns that. Never kill something that answered.
 *  - `wedged`: still connected and silent past the deadline. Busy or hung;
 *    {@link ensureDaemonReachable}'s pid check decides.
 *  - `absent`: the connect failed, OR the peer dropped us before answering.
 *
 * A daemon shutting down destroys every client socket (`server.ts` close()),
 * so a probe in that window is dropped. It is leaving, so `absent` (stop+spawn)
 * is right; `wedged` would make an engine-session caller throw instead.
 *
 * The discriminator is the CONNECTION dying, not the promise rejecting: a
 * version-mismatched daemon's hello rejects while it is alive. `onSocketClose`
 * fails the request and emits `close` in one synchronous step, so the flag is
 * set before the race resumes.
 */
export async function probeDaemonSocket(
  socketPath: string,
  timeoutMs: number = DAEMON_HELLO_TIMEOUT_MS,
): Promise<DaemonSocketState> {
  const probe = new KobeDaemonClient(socketPath)
  try {
    await probe.connect()
  } catch {
    probe.close()
    return "absent"
  }
  let droppedByPeer = false
  const offClose = probe.onLifecycle("close", () => {
    droppedByPeer = true
  })
  const replied = probe
    .request("hello", { protocolVersion: DAEMON_PROTOCOL_VERSION })
    .then(() => true)
    .catch(() => true)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  const settled = await Promise.race([replied, timedOut])
  if (timer) clearTimeout(timer)
  // Unsubscribe before `close()`: the verdict must depend on the PEER dropping
  // us, never on our own teardown (which `onSocketClose`'s stale guard already mutes).
  offClose()
  probe.close()
  if (droppedByPeer) return "absent"
  return settled ? "alive" : "wedged"
}

/** Back-compat boolean view of {@link probeDaemonSocket}. */
export async function testDaemonResponds(
  socketPath: string,
  timeoutMs: number = DAEMON_HELLO_TIMEOUT_MS,
): Promise<boolean> {
  return (await probeDaemonSocket(socketPath, timeoutMs)) === "alive"
}

/**
 * This process runs from an install removed from disk (e.g. a brew copy
 * uninstalled while its GUI kept running): the entry {@link resolveKobeSpawn}
 * would re-exec is gone, so every retry fails identically. Retrying callers
 * treat it as terminal (`runReconnectLoop`); `rove doctor` names it. The
 * remedy is reinstalling.
 */
export class StaleInstallError extends Error {
  readonly candidates: readonly string[]
  constructor(cliName: string, dir: string, candidates: readonly string[]) {
    super(
      `${cliName}: this process is running from an install that no longer exists on disk — no ${cliName} entry near ${dir} (checked ${candidates.join(", ")}). Reinstall (\`npm install -g @sma1lboy/rove\`) and relaunch Rove.`,
    )
    this.name = "StaleInstallError"
    this.candidates = candidates
  }
}

/** True for {@link StaleInstallError}, across the package boundary (an
 *  `instanceof` over two copies of the module would miss). */
export function isStaleInstallError(err: unknown): boolean {
  return err instanceof Error && err.name === "StaleInstallError"
}

/**
 * `[command, ...args]` for spawning a detached CLI child. Layouts:
 *  - dev, kobe source: entry at `../cli/<name>.ts` from this module.
 *  - dev, `packages/kobe-daemon` source: entry in sibling `packages/kobe/src/cli`.
 *  - npm: bundled into `dist/cli/<name>.js`; the active wrapper is reused.
 *  - `bun build --compile` binary: `process.execPath` IS the CLI; re-exec it.
 */
export function resolveKobeSpawn(
  subcommand: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  /** Injectable so a test can point at a missing directory (the stale-install case). */
  moduleFile: string = fileURLToPath(import.meta.url),
): string[] {
  const here = moduleFile
  if (here.startsWith("/$bunfs") || here.startsWith("B:\\~BUN")) {
    return [process.execPath, ...subcommand]
  }
  const dir = dirname(here)
  const cliName = env.ROVE_INVOKED_AS === ROVE_PRODUCT_NAME ? ROVE_PRODUCT_NAME : LEGACY_KOBE_PRODUCT_NAME
  const candidates = [
    resolve(dir, `../cli/${cliName}.ts`),
    resolve(dir, `../../../kobe/src/cli/${cliName}.ts`),
    resolve(dir, `../cli/${cliName}.js`),
    resolve(dir, "../cli/index.ts"),
    resolve(dir, "../../../kobe/src/cli/index.ts"),
    resolve(dir, "../cli/index.js"),
  ]
  const entry = candidates.find((candidate) => existsSync(candidate))
  if (entry) return [process.execPath, entry, ...subcommand]
  throw new StaleInstallError(cliName, dir, candidates)
}
