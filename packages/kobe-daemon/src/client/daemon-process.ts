import { type StdioOptions, spawn } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, statSync, unlinkSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { LEGACY_KOBE_PRODUCT_NAME, ROVE_PRODUCT_NAME } from "../compat-env.ts"
import { isProcessAlive, stopDaemonProcess } from "../daemon/lifecycle.ts"
import { defaultDaemonLogPath, defaultDaemonPidPath, defaultDaemonSocketPath } from "../daemon/paths.ts"
import { DAEMON_PROTOCOL_VERSION } from "../daemon/protocol.ts"
import { readPidFile } from "../daemon/socket-guard.ts"
import { KobeDaemonClient } from "./index.ts"

const DAEMON_START_ARGS = ["daemon", "start"] as const

/**
 * How long to wait for a `hello` round-trip before declaring a daemon
 * WEDGED (process alive, socket accepting, but not servicing requests). A
 * healthy daemon answers `hello` in well under 100ms; 3s is a wide margin
 * so a momentarily-busy daemon is never mistaken for a wedged one.
 */
const DAEMON_HELLO_TIMEOUT_MS = 3000

/**
 * How long a daemon whose PROCESS is alive gets to answer hello before we
 * call it wedged. Deliberately much longer than {@link
 * DAEMON_HELLO_TIMEOUT_MS}: that timeout decides "is this daemon quick",
 * this one decides "is this daemon dead", and only the second one licenses
 * a kill. Covers a cold-start plugin-host scan plus a burst of concurrent
 * task creation — the shape that produced the 2026-08-29 succession storm.
 */
const BUSY_DAEMON_GRACE_MS = 15_000

/**
 * How a background child is cut loose from this process.
 *
 * On Windows `detached: true` means DETACHED_PROCESS: the child gets its OWN
 * console, which the OS renders as a stray terminal window next to the TUI,
 * retitling itself after whatever the hosted PTY happens to be running. libuv
 * gives DETACHED_PROCESS precedence over CREATE_NO_WINDOW, so `windowsHide`
 * cannot suppress it — the flag itself has to go. Nothing is lost: `detached`
 * only buys POSIX setsid, and an unref'd Windows child already outlives its
 * parent. POSIX keeps detaching exactly as before.
 */
export function detachOptions(
  platform: NodeJS.Platform = process.platform,
): { windowsHide: true } | { detached: true } {
  return platform === "win32" ? { windowsHide: true } : { detached: true }
}

/**
 * Spawn the detached daemon child with stdout/stderr appended to
 * `logPath`, so a crash leaves a trace. Previously the daemon ran with
 * `stdio: "ignore"` and any crash output went to `/dev/null` — the
 * daemon just vanished. Falls back to `"ignore"` if the log file can't
 * be opened (never block the daemon from starting over a log file).
 * The parent closes its copy of the fd after the fork; the child keeps
 * its own.
 */
export function spawnDetachedDaemon(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
): void {
  let stdio: StdioOptions = "ignore"
  let logFd: number | undefined
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    logFd = openSync(logPath, "a")
    stdio = ["ignore", logFd, logFd]
  } catch {
    stdio = "ignore"
  }
  const child = spawn(command, [...args], { ...detachOptions(), stdio, env })
  child.unref()
  if (logFd !== undefined) {
    try {
      closeSync(logFd)
    } catch {
      /* parent's copy only — child holds its own dup */
    }
  }
}

/**
 * True when this process runs INSIDE a kobe engine session — the launch
 * script exports `KOBE_TASK_ID` into every engine tab. Helpers there (an
 * agent's `kobe api`, a hook) must never KILL the shared daemon: a daemon
 * that's merely busy past the hello timeout looks "wedged" from here, and
 * the old stop-then-spawn path replaced it with a session-env clone — the
 * 2026-07-13 zombie/socket-steal incident.
 */
function insideEngineSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.KOBE_TASK_ID === "string" && env.KOBE_TASK_ID !== ""
}

/**
 * Env for an AUTOSPAWNED daemon: drop the spawning process's engine-session
 * identity (a helper inside an engine tab must not stamp its task/tab/TUI
 * markers onto a long-lived shared daemon) and set the autospawn flag the
 * daemon's lifetime policy reads (first-gui grace — a spawned daemon whose
 * client never attaches as a gui reaps itself instead of living forever).
 * Exported for tests.
 */
export function autospawnDaemonEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
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
  return { ...rest, KOBE_DAEMON_AUTOSPAWNED: "1", ROVE_DAEMON_AUTOSPAWNED: "1" }
}

/**
 * Cross-process autospawn mutex (issue #10). Concurrent clients that all
 * find the daemon unreachable — a TUI gui plus its helper pane reconnecting
 * after the same daemon drop (the 2026-08-11 twin autospawn, 45ms apart) —
 * must not EACH run the stop+spawn sequence: stacked `stopDaemonProcess`
 * calls SIGKILL each other's freshly-spawned daemons and unlink the live
 * socket, which is how split-brain succession starts. One `wx` lockfile
 * next to the pidfile serializes them; losers wait for the winner's daemon
 * instead of spawning their own. Stale threshold covers the winner's worst
 * case so a crashed winner never blocks recovery for long — see the budget
 * arithmetic on the constants below.
 */
// Both budgets must cover the WINNER's worst case, or the losers give up
// (or steal the lock as stale) while it is still legitimately working:
//   BUSY_DAEMON_GRACE_MS (15s waiting out a busy daemon)
// + stopDaemonProcess escalation (~7s graceful → SIGTERM → SIGKILL)
// + spawn poll (5s)
// ≈ 27s. Stale must exceed wait so a still-working winner is never robbed
// of its own lock by a peer that merely got bored.
const SPAWN_LOCK_STALE_MS = 40_000
const SPAWN_LOCK_WAIT_MS = 30_000

/** Try to take the spawn lock; returns false when a fresh lock is held by
 *  someone else. Reclaims stale locks. Exported for tests. */
export function tryAcquireSpawnLock(lockPath: string, staleMs: number = SPAWN_LOCK_STALE_MS): boolean {
  const create = (): boolean => {
    // A fresh KOBE_HOME has no .kobe dir yet; without this, openSync throws
    // ENOENT which the catch below misreads as "lock held by someone else"
    // and the very first command stalls 15s then fails (issue #17).
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
      // Lost the stale-reclaim race (or the lock vanished and reappeared) —
      // treat as held; the caller's wait loop covers us.
      return false
    }
  }
}

/**
 * If the daemon socket already answers, do nothing. Otherwise spawn a
 * detached `kobe daemon start` (session-scrubbed env, autospawn-flagged —
 * see {@link autospawnDaemonEnv}) and poll until the socket is reachable
 * (5s deadline). Both the TUI startup path and the in-session "Restart
 * daemon" prompt share this so the spawn+poll loop lives in exactly one
 * place. Returns the resolved socket path; throws if the daemon never
 * comes up — or, inside an engine session, when the daemon is wedged
 * (session helpers never kill/replace the shared daemon).
 */
export async function ensureDaemonReachable(): Promise<string> {
  const socketPath = defaultDaemonSocketPath()
  const state = await probeDaemonSocket(socketPath)
  if (state === "alive") return socketPath

  if (state === "wedged" && insideEngineSession()) {
    // The socket CONNECTS but hello is slow — a busy daemon is
    // indistinguishable from a wedged one from in here, and killing the
    // shared daemon from a session helper is how split-brain starts.
    // Leave recovery to the human-driven path (a real TUI boot / `rove
    // doctor`); fail with the cause instead.
    throw new Error(
      `rove: daemon at ${socketPath} is not answering hello (busy or wedged); not restarting it from inside an engine session — retry, or run \`rove daemon restart\` from a regular shell`,
    )
  }

  const lockPath = `${defaultDaemonPidPath()}.spawn-lock`
  if (!tryAcquireSpawnLock(lockPath)) {
    // Another client is mid stop+spawn — wait for ITS daemon rather than
    // stacking a second kill+spawn on top.
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
    // Re-probe under the lock: the previous holder may have brought a
    // daemon up between our probe above and the lock acquisition.
    if ((await probeDaemonSocket(socketPath)) === "alive") return socketPath

    // A SLOW HELLO IS NOT A DEAD DAEMON. `probeDaemonSocket` reports
    // whether the daemon ANSWERED within `DAEMON_HELLO_TIMEOUT_MS`, which a
    // healthy-but-busy daemon can miss — spawning three tasks at once was
    // enough on the owner's machine (2026-08-29). Treating that as death
    // starts a succession storm that feeds itself:
    //
    //   busy daemon misses hello → client kills it and unlinks the socket →
    //   spawns a replacement → the old daemon's ownership guard sees a
    //   different inode and self-stops → every client's connection drops →
    //   each GUI reconnects with ZERO delay → they all probe a daemon that
    //   is now cold-starting → it misses hello → repeat.
    //
    // Eleven successions in one 50-minute window, with `rove api` failing
    // intermittently throughout. The spawn lock does not help: it
    // serializes the killing, it does not question it.
    //
    // So before killing anything, ask the OS. `kill(pid, 0)` answers
    // whether the PROCESS exists, which is the question we actually have;
    // the socket only ever answered whether it was quick enough. A live pid
    // means the daemon is busy, not wedged — back off and let it finish.
    // Only an absent (or unreadable) pidfile justifies the stop+spawn.
    const livePid = await readPidFile(defaultDaemonPidPath())
    if (livePid !== null && livePid !== process.pid && isProcessAlive(livePid)) {
      const deadline = Date.now() + BUSY_DAEMON_GRACE_MS
      while (Date.now() < deadline) {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 250))
        if (await testDaemonResponds(socketPath)) return socketPath
        // It died on its own while we waited (crash, or a legitimate idle
        // stop): the pid is gone, so the stop+spawn below is now correct.
        if (!isProcessAlive(livePid)) break
      }
      // Still alive and still not answering after the grace window — this
      // is a genuinely wedged daemon, and stopDaemonProcess's escalation
      // (graceful → SIGTERM → SIGKILL) is the right tool.
    }

    // Absent, or wedged outside a session: kill any wedged process FIRST —
    // `stopDaemonProcess` is idempotent (just clears stale socket/pidfile
    // when nothing is alive) and prevents a fresh spawn from racing a
    // still-alive wedged daemon onto the same tasks.json (split-brain).
    await stopDaemonProcess(socketPath, defaultDaemonPidPath()).catch(() => {})

    const [command, ...args] = resolveKobeSpawn(DAEMON_START_ARGS)
    spawnDetachedDaemon(command, args, autospawnDaemonEnv(), defaultDaemonLogPath())

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

export async function connectOrStartDaemon(): Promise<KobeDaemonClient> {
  const socketPath = await ensureDaemonReachable()
  const client = new KobeDaemonClient(socketPath)
  await client.connect()
  return client
}

/**
 * Connect to the daemon ONLY if one is already running and responsive —
 * never spawn one. Returns `null` when the daemon is absent or wedged.
 * For side-effect-light commands (e.g. `kobe add`'s worktree scan) that
 * want to sync with a live daemon when present but must not boot one as
 * a side effect.
 */
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
 * Probe the daemon at `socketPath`: does it accept a connection, and does
 * it answer `hello` within `timeoutMs`? Three outcomes, and each one is a
 * different question about the SAME socket:
 *
 *  - `alive` — the daemon ANSWERED. Any response frame counts, including a
 *    version-mismatch error: an old daemon that talks back is running and
 *    serving other clients, and the caller's real connect is where that
 *    mismatch belongs. Never kill something that answered.
 *  - `wedged` — connected, STILL connected, and silent past the deadline.
 *    Busy or genuinely hung; the caller decides which (see
 *    {@link ensureDaemonReachable}'s pid check).
 *  - `absent` — nothing usable here: the connect failed, OR the peer
 *    dropped the connection before answering.
 *
 * That last clause is the 2026-08-30 fix (issue #83). A daemon in its
 * shutdown path destroys every client socket (`server.ts` close()), so a
 * probe landing in that window used to connect, get dropped, and — because
 * the hello was `.catch(() => true)` — be reported ALIVE. The caller then
 * held a socket that vanished milliseconds later. A closing daemon is
 * `absent`, not `wedged`: it is leaving, so stop+spawn is the right
 * recovery, whereas `wedged` would make `ensureDaemonReachable` throw
 * inside an engine session rather than recover.
 *
 * The discriminator is the CONNECTION dying, not the promise rejecting —
 * conflating the two is what would kill a version-mismatched daemon, whose
 * hello rejects while the daemon is perfectly alive. We read it off the
 * client's `close` lifecycle instead: `onSocketClose` fails the pending
 * request and emits `close` in the same synchronous step, so the flag is
 * set before the awaited race resumes on the following microtask.
 *
 * Exported for tests.
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
  // Unsubscribe before `close()`: plain listener hygiene. `close()` nulls the
  // socket first, so its own OS close event trips `onSocketClose`'s stale
  // guard and emits nothing — but the verdict below must depend on the PEER
  // dropping us, never on our own teardown, so don't leave the listener armed.
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
 * Build the argv used to spawn a detached CLI child.
 * Returns `[command, ...args]`; callers pass to `child_process.spawn`
 * as `spawn(command, args, opts)`.
 *
 * Four layouts are possible:
 *  - dev, pre-extraction: running from kobe source. `import.meta.url`
 *    points at `.../src/client/daemon-process.ts`; the active compatibility
 *    entry sits at `../cli/<name>.ts` relative to it.
 *  - dev, daemon workspace: running from `packages/kobe-daemon` source.
 *    The cli entry sits in sibling workspace `packages/kobe/src/cli`.
 *  - npm package: daemon-process is bundled into `dist/cli/<name>.js`, so
 *    `import.meta.url` resolves there and the active wrapper is reused.
 *  - standalone: running a `bun build --compile` binary. `process.execPath`
 *    IS the kobe binary, so we re-exec it directly. After the kobed → kobe
 *    bin merge, no sibling lookup is needed.
 */
export function resolveKobeSpawn(subcommand: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const here = fileURLToPath(import.meta.url)
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
  throw new Error(`${cliName}: could not locate ${cliName} entry near ${dir}; checked ${candidates.join(", ")}`)
}
