import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { COMPAT_STATE_DIR_BASENAME, ROVE_STATE_DIR_BASENAME, readRoveEnv, readRoveHomeDirEnv } from "../compat-env.ts"

/**
 * Runtime files live under `.rove`; `.kobe` is legacy. A socket path is the
 * ADDRESS of a running process: switching blindly would hide the live daemon
 * and PTY host from a new client, which would start a second pair and orphan
 * every engine tab. Rule: canonical if it exists, else legacy IF its process
 * is alive, else canonical. A crash-stale `.kobe` socket fails liveness.
 */
function stateDirs(homeDir: string): { canonical: string; legacy: string } {
  return { canonical: join(homeDir, ROVE_STATE_DIR_BASENAME), legacy: join(homeDir, COMPAT_STATE_DIR_BASENAME) }
}

/** True when `pidPath` names a process this machine still has. */
function pidIsLive(pidPath: string): boolean {
  try {
    const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10)
    if (!Number.isInteger(pid) || pid <= 1) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Canonical path, unless only the legacy layout holds a LIVE process (per its `pidName` pidfile). */
function runtimePath(homeDir: string, name: string, pidName: string): string {
  const { canonical, legacy } = stateDirs(homeDir)
  const canonicalPath = join(canonical, name)
  if (existsSync(canonicalPath)) return canonicalPath
  const legacyPath = join(legacy, name)
  if (existsSync(legacyPath) && pidIsLive(join(legacy, pidName))) return legacyPath
  return canonicalPath
}

/**
 * Pre-rename location of a runtime file. Binding side only: after bind it
 * links legacy → canonical so an older binary still finds the daemon/host
 * (`compat-link.ts`). Resolution uses `runtimePath`, never this.
 */
export function legacyRuntimePath(homeDir: string, name: string): string {
  return join(homeDir, COMPAT_STATE_DIR_BASENAME, name)
}

export function legacyDaemonSocketPath(homeDir: string): string {
  return legacyRuntimePath(homeDir, "daemon.sock")
}

export function legacyDaemonPidPath(homeDir: string): string {
  return legacyRuntimePath(homeDir, "daemon.pid")
}

export function legacyPtyHostSocketPath(homeDir: string): string {
  return legacyRuntimePath(homeDir, "pty.sock")
}

export function legacyPtyHostPidPath(homeDir: string): string {
  return legacyRuntimePath(homeDir, "pty.pid")
}

/**
 * Data read back across restarts: always canonical. The PTY host migrates
 * legacy entries at boot (`pty-data-migration.ts`, the single-writer moment);
 * a "whichever layout has it" rule would pin data under `.kobe`, and deleting
 * `~/.kobe` (documented as safe) would lose frozen sessions.
 */
function runtimeDataPath(homeDir: string, name: string): string {
  return join(stateDirs(homeDir).canonical, name)
}

/**
 * `sun_path` caps: macOS/BSD 104 bytes, Linux 108; 100 leaves room for a
 * `bridge-<pid>.sock` suffix. Deep worktree homes (`dev:sandbox`) overrun 104,
 * and `listen()` then rejects silently.
 */
const SOCKET_PATH_SAFETY_LIMIT = 100

/** Stable per-home tag for fallback socket names, so different homes never collide in `$TMPDIR`. */
export function shortHomeTag(homeDir: string): string {
  return createHash("sha1").update(homeDir).digest("hex").slice(0, 8)
}

/**
 * `naturalPath` if within the limit, else `$TMPDIR/kobe-<homeTag>-<role>.sock`.
 * The fallback MUST be deterministic per (homeDir, role) or clients can't find
 * the socket. `pidTag` is only for ephemeral per-PID sockets (the bridge); omit
 * it for paths that must stay stable across restarts.
 */
export function fitSocketPath(naturalPath: string, homeDir: string, role: string, pidTag?: number): string {
  if (Buffer.byteLength(naturalPath, "utf8") <= SOCKET_PATH_SAFETY_LIMIT) return naturalPath
  const tag = shortHomeTag(homeDir)
  const suffix = pidTag === undefined ? "" : `-${pidTag}`
  const fallback = join(tmpdir(), `kobe-${tag}-${role}${suffix}.sock`)
  if (Buffer.byteLength(fallback, "utf8") <= SOCKET_PATH_SAFETY_LIMIT) return fallback
  throw new Error(`daemon socket path exceeds ${SOCKET_PATH_SAFETY_LIMIT} bytes even after fallback: ${fallback}`)
}

/**
 * Resolution order (after the `DAEMON_SOCKET_PATH` override):
 *   1. `homeDir` argument → `<homeDir>/.rove/daemon.sock`.
 *   2. `ROVE_HOME_DIR`/`KOBE_HOME_DIR` → `$ROVE_HOME_DIR/.rove/daemon.sock`.
 *   3. `XDG_RUNTIME_DIR` → `$XDG_RUNTIME_DIR/kobe.sock`.
 *   4. `~/.rove/daemon.sock`.
 * Steps 1, 2 and 4 yield the legacy `.kobe` twin only while a pre-rename
 * process holds it ({@link stateDirs}). Every result goes through
 * {@link fitSocketPath}.
 *
 * XDG sits below the env step: Linux desktops always set it, which would
 * collapse test and production daemons onto one socket.
 *
 * Stays a filesystem socket on Windows, unlike {@link defaultPtyHostSocketPath}:
 * Bun (the daemon) binds AF_UNIX on Windows 10+, node (the PTY host) gets
 * EACCES. The split follows the RUNTIME, not the platform.
 */
export function defaultDaemonSocketPath(homeDir?: string): string {
  const override = readRoveEnv("DAEMON_SOCKET_PATH")
  if (override) return override
  const explicit = homeDir ?? readRoveHomeDirEnv()
  if (explicit && explicit.length > 0) {
    return fitSocketPath(runtimePath(explicit, "daemon.sock", "daemon.pid"), explicit, "daemon")
  }
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  if (runtimeDir && runtimeDir.length > 0) {
    return fitSocketPath(join(runtimeDir, "kobe.sock"), runtimeDir, "daemon")
  }
  const home = homedir()
  return fitSocketPath(runtimePath(home, "daemon.sock", "daemon.pid"), home, "daemon")
}

/**
 * State root the daemon serves: explicit option, else the ambient home (as
 * `resolveProductHomeDir` in `product-paths.ts`). `hello` reports it; the
 * client compares it to its own before trusting the task list.
 */
export function resolveDaemonHomeDir(homeDir?: string): string {
  const explicit = homeDir ?? readRoveHomeDirEnv()
  return explicit && explicit.length > 0 ? explicit : homedir()
}

export function defaultDaemonPidPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  const override = readRoveEnv("DAEMON_PID_PATH")
  if (override) return override
  return runtimePath(homeDir, "daemon.pid", "daemon.pid")
}

/** Detached daemon's stdout/stderr, so an uncaught crash leaves a trace. */
export function defaultDaemonLogPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "daemon.log")
}

/**
 * CLIENT-side log (OpenTUI panes, front-end attach). The TUI swallows their
 * `console.*`, so this file is the only record of connection churn.
 */
export function defaultClientLogPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "client.log")
}

/**
 * True for a Windows named pipe. Skip filesystem steps (mkdir parent, unlink)
 * for it: `\\.\pipe` is a namespace, and the pipe dies with its creator.
 */
export function isWindowsPipePath(path: string): boolean {
  return path.startsWith("\\\\.\\pipe\\") || path.startsWith("//./pipe/")
}

/**
 * Windows named pipe for a host role, tagged per home. The Windows PTY host
 * runs under node (Bun rejects its `terminal` spawn option there, see
 * pty-driver.ts), and node can't bind AF_UNIX on Windows (EACCES). Bun's
 * client and the wire protocol are unchanged. The trigger is the RUNTIME: the
 * Bun daemon keeps a unix socket ({@link defaultDaemonSocketPath}).
 */
export function windowsPipePath(homeDir: string, role: string): string {
  return `\\\\.\\pipe\\kobe-${shortHomeTag(homeDir)}-${role}`
}

/**
 * Socket for the standalone PTY HOST (`kobe pty-host`), which owns terminal
 * children so they survive TUI exits AND `kobe daemon restart`. Separate from
 * the daemon, which restarts routinely; the host is small and must keep
 * running. Same resolution/fitting as {@link defaultDaemonSocketPath}.
 */
export function defaultPtyHostSocketPath(homeDir?: string, platform: NodeJS.Platform = process.platform): string {
  const override = readRoveEnv("PTY_SOCKET_PATH")
  if (override) return override
  const explicit = homeDir ?? readRoveHomeDirEnv()
  if (platform === "win32") return windowsPipePath(explicit || homedir(), "pty")
  if (explicit && explicit.length > 0) {
    return fitSocketPath(runtimePath(explicit, "pty.sock", "pty.pid"), explicit, "pty")
  }
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  if (runtimeDir && runtimeDir.length > 0) {
    return fitSocketPath(join(runtimeDir, "kobe-pty.sock"), runtimeDir, "pty")
  }
  const home = homedir()
  return fitSocketPath(runtimePath(home, "pty.sock", "pty.pid"), home, "pty")
}

export function defaultPtyHostPidPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  const override = readRoveEnv("PTY_PID_PATH")
  if (override) return override
  return runtimePath(homeDir, "pty.pid", "pty.pid")
}

export function defaultPtyHostLogPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "pty.log")
}

/** Durable per-session death records (`pty-exit-store.ts`) — must outlive
 *  the host's idle-exit, so a crashed engine's cause stays queryable. */
export function defaultPtyExitsPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return runtimeDataPath(homeDir, "pty-exits.json")
}

/** PTY sidecar bearer token (`web-token.ts`). Its own 0600 file, not a
 *  `state.json` field: state.json gets pasted into bug reports, and this file
 *  can be chmod'd whole and rotated with one `rm`. */
export function defaultWebTokenPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return runtimeDataPath(homeDir, "web-token")
}

/** Frozen session snapshots (`pty-freeze-store.ts`), one JSON per session
 *  key: metadata + scrollback handed to the next host after a restart. */
export function defaultPtyFreezeDir(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return runtimeDataPath(homeDir, "pty-sessions")
}

/** Per-session delivery locks (`engine/delivery-lock.ts`), held for one
 *  paste→submit. Not in the OS temp dir, so `rove reset` clears them and
 *  senders with different `TMPDIR`s contend for the same file. */
export function defaultDeliveryLockDir(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return runtimeDataPath(homeDir, "delivery-locks")
}
