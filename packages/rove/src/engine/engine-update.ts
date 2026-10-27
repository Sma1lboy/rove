/**
 * Is a running engine older than the CLI now installed under its name? An
 * upgrade lands as new files (or a symlink switched to a new version), so the
 * binary the engine's executable resolves to NOW changed after the process
 * started. Inode change time, not mtime: package managers stamp extracted
 * files with a fixed mtime, and nothing in userspace can backdate a ctime.
 */

import { stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { recordSpawn } from "../lib/spawn-profile.ts"
import { executableTokenFromArgv } from "./foreground.ts"

/** The engine process a walk found: its pid and its command line as `ps` prints it. */
export interface WalkedEngine {
  readonly pid: number
  readonly argv: string
}

export interface EngineUpdateDeps {
  /** `ps -o pid=,etime= -p …` text for these pids. */
  readonly elapsed: (pids: readonly number[]) => Promise<string>
  /** A bare executable name on PATH, or null. */
  readonly which: (name: string) => string | null
  /** The path's (symlinks followed) inode change time in ms, or null when unreadable. */
  readonly changedAt: (path: string) => Promise<number | null>
  readonly now: () => number
}

/** `etime` is whole seconds, so a binary written in the second before launch must not read as newer. */
const ETIME_SLACK_MS = 1_000
const PS_TIMEOUT_MS = 5_000

/** POSIX `etime`, `[[dd-]hh:]mm:ss`, in seconds; null when malformed. */
export function parseEtime(text: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim())
  if (!m) return null
  const [, days = "0", hours = "0", minutes, seconds] = m
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)
}

/** The file the engine's executable token names now; null for a relative path, which only the engine's cwd could resolve. */
function binaryPath(argv: string, which: EngineUpdateDeps["which"]): string | null {
  const token = executableTokenFromArgv(argv.trim().split(/\s+/))
  if (!token) return null
  if (token.includes("/")) return isAbsolute(token) ? token : null
  return which(token)
}

/**
 * Per session key: `true` = the engine's binary changed after it started,
 * `false` = it did not, `null` = could not tell (no engine walked, `ps` or
 * `stat` failed, the binary no longer resolves). Never throws.
 */
export async function engineUpdates(
  engines: ReadonlyMap<string, WalkedEngine | null>,
  deps: EngineUpdateDeps = defaultEngineUpdateDeps,
): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>([...engines.keys()].map((key) => [key, null]))
  const walked = [...engines].filter((entry): entry is [string, WalkedEngine] => entry[1] !== null)
  if (walked.length === 0) return out
  const startedAt = new Map<number, number>()
  try {
    const now = deps.now()
    for (const line of (await deps.elapsed(walked.map(([, e]) => e.pid))).split("\n")) {
      const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(line)
      const secs = m ? parseEtime(m[2] as string) : null
      if (m && secs !== null) startedAt.set(Number(m[1]), now - secs * 1000)
    }
  } catch {
    return out
  }
  await Promise.all(
    walked.map(async ([key, engine]) => {
      const started = startedAt.get(engine.pid)
      const path = binaryPath(engine.argv, deps.which)
      if (started === undefined || path === null) return
      const changed = await deps.changedAt(path)
      if (changed !== null) out.set(key, changed > started + ETIME_SLACK_MS)
    }),
  )
  return out
}

async function psElapsed(pids: readonly number[]): Promise<string> {
  if (process.platform === "win32") throw new Error("no etime on win32")
  const argv = ["ps", "-o", "pid=,etime=", "-p", pids.join(",")]
  recordSpawn("engine.updateCheck", argv)
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" })
  const timer = setTimeout(() => proc.kill(), PS_TIMEOUT_MS)
  try {
    return await new Response(proc.stdout).text()
  } finally {
    clearTimeout(timer)
  }
}

export const defaultEngineUpdateDeps: EngineUpdateDeps = {
  elapsed: psElapsed,
  which: (name) => Bun.which(name),
  changedAt: async (path) => {
    try {
      return (await stat(path)).ctimeMs
    } catch {
      return null
    }
  },
  now: () => Date.now(),
}
