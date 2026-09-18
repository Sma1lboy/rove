/**
 * Client-side lifecycle for the standalone PTY HOST process
 * (`kobe pty-host`, see `daemon/pty-server.ts`) — the tmux-server analog
 * that keeps embedded-terminal children alive across TUI exits AND
 * `kobe daemon restart`. Mirrors `daemon-process.ts`'s spawn-and-poll
 * shape against the pty host's own socket.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { rename, rm } from "node:fs/promises"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { logDaemonInfo } from "../daemon/crash-log.ts"
import { isProcessAlive, stopDaemonProcess } from "../daemon/lifecycle.ts"
import { defaultPtyHostLogPath, defaultPtyHostPidPath, defaultPtyHostSocketPath } from "../daemon/paths.ts"
import type { PtySessionInfo } from "../daemon/pty-observability.ts"
import { readPidFile } from "../daemon/socket-guard.ts"
import { resolveKobeSpawn, testDaemonResponds } from "./daemon-process.ts"
import { spawnDetachedDaemon } from "./detached-spawn.ts"
import { KobeDaemonClient } from "./index.ts"
import { windowsPowershellPath } from "./win-detached-launch.ts"

const PTY_HOST_START_ARGS = ["pty-host"] as const

/** Where `bun run build` puts the node PTY host, relative to the cli bundle. */
const PTY_HOST_NODE_BUNDLE = "pty-host-node.mjs"
/** Dev-only build cache. Must sit INSIDE the daemon package so the bundle's
 *  external `node-pty` import resolves against its node_modules. */
const PTY_HOST_NODE_DEV_CACHE = "../../.cache/pty-host-node.mjs"
const PTY_HOST_NODE_ENTRY = "../daemon/pty-host-node-entry.ts"

export interface NodePtyHostResolution {
  /** Real platform by default; injected so the Windows path is testable on CI. */
  readonly platform?: NodeJS.Platform
  /** Directory this module resolves its siblings against. */
  readonly moduleDir?: string
  readonly exists?: (path: string) => boolean
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Lands a node bundle of `entry` at `outFile`. Injected to keep the unit
   *  test off the bundler; landing it atomically is the impl's business. */
  readonly bundle?: (entry: string, outFile: string) => Promise<{ success: boolean; logs: readonly unknown[] }>
}

/**
 * Locate `node` on PATH, returning its absolute path.
 *
 * The Windows PTY host is a node program, but kobe itself runs under Bun — and
 * `bun install -g @sma1lboy/rove` never brings node along. Without this the
 * spawn fails silently into the host's log and `ensurePtyHostReachable` only
 * reports a 5s timeout, which says nothing about the actual cause. Resolving
 * to an absolute path also stops the detached child from depending on however
 * PATH looks by the time it starts.
 */
export function resolveNodeBinary(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter((dir) => dir.length > 0)
  // PATHEXT is what makes a bare `node` runnable on Windows; node.exe is the
  // real one, but a Volta/fnm shim may only put node.cmd on PATH.
  const suffixes =
    platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter((ext) => ext.length > 0) : [""]
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = join(dir, `node${suffix}`)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

export interface BundleIo {
  build: (config: {
    entrypoints: string[]
    outdir: string
    target: string
    format: string
    naming: string
    external: string[]
  }) => Promise<{ success: boolean; logs: readonly unknown[] }>
  rename: (from: string, to: string) => Promise<void>
  discard: (path: string) => Promise<void>
}

/** Injected so the staging→rename dance is assertable without a bundler. */
export async function bundleWithBun(entry: string, outFile: string, io?: BundleIo) {
  const {
    build,
    rename: move,
    discard,
  } = io ?? {
    // Lazy: `Bun` is not a global under the test runner, and this default is
    // never evaluated when `io` is supplied.
    build: (config: Parameters<BundleIo["build"]>[0]) => Bun.build(config as Parameters<typeof Bun.build>[0]),
    rename,
    discard: (path: string) => rm(path, { force: true }),
  }
  // Build to a pid-unique sibling, then rename into place. Two kobe instances
  // can reach this together — both find no host, both rebuild the same
  // absolute path — and node must never load a half-written module. rename is
  // atomic on one volume, and node's Windows rename replaces the destination
  // rather than failing on it.
  const staging = `${outFile}.${process.pid}.tmp`
  const built = await build({
    entrypoints: [entry],
    outdir: dirname(staging),
    target: "node",
    format: "esm",
    naming: basename(staging),
    external: ["node-pty"],
  })
  if (!built.success) {
    // Leaving the partial behind would have the next run rename garbage into
    // the path the host is spawned from.
    await discard(staging).catch(() => {})
    return built
  }
  await move(staging, outFile)
  return built
}

/**
 * Windows runs the PTY host under NODE, not Bun: Bun rejects its `terminal`
 * spawn option there, and a Bun-hosted node-pty session can be read but never
 * written to. Returns `[node, script]`, or null when this isn't Windows (every
 * other platform keeps the ordinary `kobe pty-host` Bun path).
 *
 * Two layouts, mirroring {@link resolveKobeSpawn}:
 *  - installed package: `dist/cli/pty-host-node.mjs`, emitted by scripts/build.ts
 *    next to the cli bundle.
 *  - dev from source: no dist, so bundle the entry on demand into the daemon
 *    package's `.cache/` (gitignored) and run that.
 */
export async function resolveNodePtyHostSpawn(deps: NodePtyHostResolution = {}): Promise<string[] | null> {
  const platform = deps.platform ?? process.platform
  if (platform !== "win32") return null
  const here = deps.moduleDir ?? dirname(fileURLToPath(import.meta.url))
  const exists = deps.exists ?? existsSync
  const bundle = deps.bundle ?? bundleWithBun

  const node = resolveNodeBinary(deps.env ?? process.env, exists, platform)
  if (!node) {
    throw new Error(
      "Rove: the Windows PTY host runs under node, but no node was found on PATH. " +
        "Install Node.js (https://nodejs.org) and restart Rove — engine and terminal sessions cannot start without it.",
    )
  }

  const packaged = resolve(here, PTY_HOST_NODE_BUNDLE)
  if (exists(packaged)) return [node, packaged]

  const entry = resolve(here, PTY_HOST_NODE_ENTRY)
  if (!exists(entry)) {
    throw new Error(`Rove: no Windows PTY host found (looked for ${packaged} and ${entry})`)
  }
  const cache = resolve(here, PTY_HOST_NODE_DEV_CACHE)
  const built = await bundle(entry, cache)
  if (!built.success) {
    throw new Error(`Rove: could not build the Windows PTY host — ${built.logs.map(String).join("; ")}`)
  }
  return [node, cache]
}

/**
 * How long a pty host whose PROCESS is alive gets to answer `hello` before it
 * counts as wedged. The twin of `daemon-process.ts`'s `BUSY_DAEMON_GRACE_MS`,
 * and for the same reason: one 3s probe decides "is this host quick", and
 * only a sustained silence may license a kill. The pty host had no such
 * window, so a host merely busy for three seconds was reaped — along with
 * every engine it hosted.
 */
const BUSY_PTY_HOST_GRACE_MS = 15_000

/**
 * A child-count probe's whole budget. `ps` answers in ~20ms; a PowerShell
 * start plus a CIM query is ~0.8s. 5s only ever fires on a stuck process
 * table, and it is bounded at all because an abandoned probe here would hang
 * the very recovery path it guards.
 */
const CHILD_PROBE_TIMEOUT_MS = 5_000

/** Injectable so the Windows half is testable on a POSIX CI host. */
export interface ChildProbeDeps {
  readonly platform?: NodeJS.Platform
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly timeoutMs?: number
  /** Filesystem probe, like {@link NodePtyHostResolution.exists}. */
  readonly exists?: (path: string) => boolean
  /** Runs one command to completion, returning stdout. Throws on failure. */
  readonly run?: (command: readonly string[], timeoutMs: number) => Promise<string>
}

/**
 * The process-table read, per platform.
 *
 * POSIX is `ps -A -o ppid=`. Windows has NO usable `ps`: the one on PATH is
 * Git for Windows' Cygwin build, which rejects `-A` and exits 1 with EMPTY
 * stdout (see `packages/kobe/src/engine/win-process-snapshot.ts`, which
 * documented the same finding for the foreground probe). `Get-CimInstance
 * Win32_Process` is the only table that answers there.
 *
 * `[Console]::OutputEncoding` is pinned to UTF-8 first: under an OEM codepage
 * (936 on a Chinese Windows) PowerShell 5.1 writes its stdout in that
 * codepage, and a UTF-8 read of it is mojibake. The answer here is digits, so
 * it survives either way — but the pin costs nothing and keeps the two
 * Windows PowerShell reads in this repo agreeing.
 *
 * Exported for tests.
 */
export function childProbeCommand(deps: ChildProbeDeps = {}): readonly string[] {
  const env = deps.env ?? process.env
  if ((deps.platform ?? process.platform) !== "win32") return ["ps", "-A", "-o", "ppid="]
  return [
    windowsPowershellPath(env, deps.exists ?? existsSync),
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    // One ParentProcessId per line — the SAME shape POSIX `ps -o ppid=`
    // prints, so one parser reads both. Emitting a count instead would need a
    // second answer format and a second set of tests for the same number.
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
      "Get-CimInstance -ClassName Win32_Process -Property ParentProcessId | " +
      "Select-Object -ExpandProperty ParentProcessId",
  ]
}

/** Run a child to completion by deadline, or throw. Exported for tests. */
export function runChildProbe(command: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((done, fail) => {
    const proc = spawn(command[0] ?? "", command.slice(1), { stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    const finish = (err: Error | null): void => {
      clearTimeout(timer)
      // Kill first: an abandoned probe holding a pipe nobody reads is how a
      // one-off hang becomes a permanent leak in a long-lived daemon.
      try {
        proc.kill()
      } catch {
        /* already gone */
      }
      if (err) fail(err)
      else done(out)
    }
    const timer = setTimeout(() => finish(new Error(`did not answer within ${timeoutMs}ms`)), timeoutMs)
    proc.stdout?.on("data", (chunk) => {
      out += String(chunk)
    })
    proc.on("error", (err) => finish(err))
    proc.on("close", () => finish(null))
  })
}

/**
 * Live child processes of `pid` — the pty host's sessions, each a shell
 * leader. **`null` means "could not read the process table"**, which is not
 * the same answer as zero and must never be folded into one.
 *
 * It used to be: `/bin/ps`, unreadable output counting as zero. On Windows
 * `/bin/ps` is always ENOENT, so the count was ALWAYS zero there, and the
 * refusal below — a live host still holding sessions may not be reaped —
 * was dead code that silently killed the PTY host and every engine in it.
 * POSIX cannot answer "zero children" with an empty table either: a healthy
 * `ps -A` returns hundreds of rows, so NO rows is a failed probe, exactly the
 * reasoning `engine/foreground.ts` applies to its own snapshot.
 *
 * Exported for tests.
 */
export async function liveChildCount(pid: number, deps: ChildProbeDeps = {}): Promise<number | null> {
  const timeoutMs = deps.timeoutMs ?? CHILD_PROBE_TIMEOUT_MS
  const command = childProbeCommand(deps)
  const run = deps.run ?? runChildProbe
  let text: string
  try {
    text = await run(command, timeoutMs)
  } catch {
    return null
  }
  const rows = text
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
  if (rows.length === 0) return null
  return rows.filter((row) => Number(row) === pid).length
}

/**
 * If the pty host socket already answers `hello`, do nothing. Otherwise
 * clear any wedged process and spawn a detached `kobe pty-host`, polling
 * until reachable. Returns the socket path. The terminal pane is the
 * product — it may resurrect an idle-exited host.
 *
 * "Idle-exited" is the whole licence. A host that EXITED owns nothing, so
 * clearing its stale socket and pidfile is free. A host that is ALIVE and
 * merely slow is a different thing entirely: killing it kills every hosted
 * engine with it, and `send` used to do exactly that off ONE 3s probe and
 * then report a bare `ok: true` — a caller asked to deliver one prompt got
 * its whole fleet reaped and was told nothing. So a live host gets the grace
 * window first, and a live host still holding sessions after it is refused
 * out loud rather than reaped silently: N engines with running work must not
 * be spent to deliver one message.
 */
export async function ensurePtyHostReachable(): Promise<string> {
  const socketPath = defaultPtyHostSocketPath()
  if (await testDaemonResponds(socketPath)) return socketPath

  const hostPid = await readPidFile(defaultPtyHostPidPath())
  if (hostPid !== null && hostPid !== process.pid && isProcessAlive(hostPid)) {
    const deadline = Date.now() + BUSY_PTY_HOST_GRACE_MS
    while (Date.now() < deadline) {
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 250))
      if (await testDaemonResponds(socketPath)) return socketPath
      // It died on its own while we waited: the pid is gone, so the
      // stop+spawn below is now the free idle-exit path.
      if (!isProcessAlive(hostPid)) break
    }
    if (isProcessAlive(hostPid)) {
      const sessions = await liveChildCount(hostPid)
      if (sessions === null) {
        throw new Error(
          `rove: the pty host (pid ${hostPid}) is not answering and Rove could not read this machine's process table, so it cannot tell whether the host still holds live sessions — refusing to restart it, which would kill every engine running in them. Inspect it with \`rove api pty-list\`, or kill ${hostPid} yourself once you have accepted losing those sessions.`,
        )
      }
      if (sessions > 0) {
        throw new Error(
          `rove: the pty host (pid ${hostPid}) is not answering but still holds ${sessions} live session(s) — refusing to restart it, which would kill every engine running in them. Inspect it with \`rove api pty-list\`, or kill ${hostPid} yourself once you have accepted losing those sessions.`,
        )
      }
    }
  }

  await stopDaemonProcess(socketPath, defaultPtyHostPidPath()).catch(() => {})

  const [command, ...args] = (await resolveNodePtyHostSpawn()) ?? resolveKobeSpawn(PTY_HOST_START_ARGS)
  spawnDetachedDaemon(command ?? "", args, process.env, defaultPtyHostLogPath())

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await testDaemonResponds(socketPath)) return socketPath
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 100))
  }
  throw new Error(
    `rove: pty host did not start (or stayed wedged) at ${socketPath}; check ${defaultPtyHostLogPath()} or run \`rove doctor\``,
  )
}

/** Observe sessions before consulting current tasks; never send a captured negative task list. */
export async function sweepPtyHostSessions(
  liveTaskIds: () => readonly string[] | null,
  homeDir?: string,
): Promise<void> {
  const client = new KobeDaemonClient(defaultPtyHostSocketPath(homeDir))
  try {
    await client.connect()
    const { sessions } = await client.request<{ sessions: PtySessionInfo[] }>("pty.list")
    let currentTasks: Set<string> | undefined
    for (const session of sessions) {
      if (!currentTasks) {
        const ids = liveTaskIds()
        if (ids === null) return // daemon shutdown supersedes pending observations
        currentTasks = new Set(ids)
      }
      if (currentTasks.has(session.key.split("::")[0] ?? session.key)) continue
      if (!session.generation) {
        logDaemonInfo(
          "pty-sweep",
          `skipped ${session.key}: host has no session generation; restart it when sessions can be interrupted`,
        )
        continue
      }
      await client.request("pty.kill", { key: session.key, expectedGeneration: session.generation })
      currentTasks = undefined // refresh only after yielding to another task mutation
    }
  } catch {
    // An unavailable host is not permission to retry a destructive request.
  } finally {
    client.close()
  }
}

/** true/false are observed session state; null means the host could not be read. Never spawns. */
export async function ptyHostHasLiveSessions(homeDir?: string): Promise<boolean | null> {
  const client = new KobeDaemonClient(defaultPtyHostSocketPath(homeDir))
  try {
    await client.connect()
    const result = await client.request<{ sessions?: Array<{ alive?: boolean }> }>("pty.list")
    if (!Array.isArray(result.sessions) || result.sessions.some((s) => typeof s.alive !== "boolean")) return null
    return result.sessions.some((s) => s.alive)
  } catch (err) {
    if (err instanceof Error && "code" in err && (err.code === "ENOENT" || err.code === "ECONNREFUSED")) {
      const pid = await readPidFile(defaultPtyHostPidPath(homeDir))
      return pid !== null && isProcessAlive(pid) ? null : false
    }
    return null
  } finally {
    client.close()
  }
}
