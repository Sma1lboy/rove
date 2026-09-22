/**
 * Client-side lifecycle for the PTY HOST (`kobe pty-host`,
 * `daemon/pty-server.ts`), which keeps terminal children alive across TUI
 * exits and `kobe daemon restart`. Same spawn-and-poll shape as
 * `daemon-process.ts`.
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

const PTY_HOST_START_ARGS = ["pty-host"] as const

/** Where `bun run build` puts the node PTY host, relative to the cli bundle. */
const PTY_HOST_NODE_BUNDLE = "pty-host-node.mjs"
/** Dev-only build cache. Must sit INSIDE the daemon package so the bundle's
 *  external `node-pty` import resolves against its node_modules. */
const PTY_HOST_NODE_DEV_CACHE = "../../.cache/pty-host-node.mjs"
const PTY_HOST_NODE_ENTRY = "../daemon/pty-host-node-entry.ts"

export interface NodePtyHostResolution {
  readonly platform?: NodeJS.Platform
  /** Directory this module resolves its siblings against. */
  readonly moduleDir?: string
  readonly exists?: (path: string) => boolean
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Lands a node bundle of `entry` at `outFile`; must land it atomically. */
  readonly bundle?: (entry: string, outFile: string) => Promise<{ success: boolean; logs: readonly unknown[] }>
}

/**
 * Absolute path of `node` on PATH. The Windows PTY host needs node, which
 * `bun install -g` never brings; unchecked, the spawn fails silently into the
 * host log and surfaces only as a 5s timeout. Absolute also frees the detached
 * child from PATH at start time.
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
    // Lazy: `Bun` is not a global under the test runner.
    build: (config: Parameters<BundleIo["build"]>[0]) => Bun.build(config as Parameters<typeof Bun.build>[0]),
    rename,
    discard: (path: string) => rm(path, { force: true }),
  }
  // Two instances can rebuild the same path at once; node must never load a
  // half-written module. rename is atomic on one volume, and on Windows node's
  // rename replaces the destination rather than failing.
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
    // A leftover partial would get renamed into the spawn path next run.
    await discard(staging).catch(() => {})
    return built
  }
  await move(staging, outFile)
  return built
}

/**
 * Windows runs the PTY host under node: Bun rejects its `terminal` spawn option
 * there, and a Bun-hosted node-pty session can be read but never written.
 * Returns `[node, script]`, or null off Windows.
 *
 * Layouts, as in {@link resolveKobeSpawn}:
 *  - installed: `dist/cli/pty-host-node.mjs`, emitted by scripts/build.ts.
 *  - dev: bundle the entry on demand into the daemon package's `.cache/`.
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
 * Grace for a live host to answer `hello` before it counts as wedged (twin of
 * `BUSY_DAEMON_GRACE_MS`): one 3s probe must not license a kill that takes
 * every hosted engine with it.
 */
const BUSY_PTY_HOST_GRACE_MS = 15_000

/** Live children of `pid` (each a session's shell leader). Unreadable `ps`
 *  counts as zero, which only makes the reap below more permissive. */
async function liveChildCount(pid: number): Promise<number> {
  try {
    const proc = spawn("/bin/ps", ["-A", "-o", "ppid="], { stdio: ["ignore", "pipe", "ignore"] })
    const text = await new Promise<string>((done) => {
      let out = ""
      proc.stdout.on("data", (chunk) => {
        out += String(chunk)
      })
      proc.on("close", () => done(out))
      proc.on("error", () => done(""))
    })
    return text.split("\n").filter((row) => Number(row.trim()) === pid).length
  } catch {
    return 0
  }
}

/**
 * Return the socket path once the pty host answers `hello`, spawning a
 * detached `kobe pty-host` if needed. Only an EXITED host may be replaced
 * freely; killing a live one kills every hosted engine. A live host gets the
 * grace window, and one still holding sessions after it is refused loudly,
 * never reaped: N running engines must not be spent to deliver one message.
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
      // Died while we waited: the stop+spawn below is now free.
      if (!isProcessAlive(hostPid)) break
    }
    if (isProcessAlive(hostPid)) {
      const sessions = await liveChildCount(hostPid)
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
  throw new Error(`rove: pty host did not start (or stayed wedged) at ${socketPath}`)
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
