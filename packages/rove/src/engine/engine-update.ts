import { realpath, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { recordSpawn } from "../lib/spawn-profile.ts"
import { executableTokenFromArgv } from "./foreground.ts"

/** The engine process a walk found: its pid and its command line as `ps` prints it. */
export interface WalkedEngine {
  readonly pid: number
  readonly argv: string
  readonly launchArgv?: readonly string[]
}

export interface EngineUpdateDeps {
  /** `ps -o pid=,etime= -p …` text for these pids. */
  readonly elapsed: (pids: readonly number[]) => Promise<string>
  /** A bare executable name on PATH, or null. */
  readonly which: (name: string) => string | null
  readonly installation: (path: string) => Promise<Installation | null>
  readonly now: () => number
}

interface Installation {
  readonly path: string
  readonly device: number
  readonly inode: number
  readonly changedAt: number
  readonly createdAt: number
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
function binaryPath(argv: readonly string[], which: EngineUpdateDeps["which"]): string | null {
  const token = executableTokenFromArgv(argv)
  if (!token) return null
  if (token.includes("/")) return isAbsolute(token) ? token : null
  return which(token)
}

/** True requires a different, newly created launch installation; uncertain comparisons stay null. */
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
      const runningPath = binaryPath(engine.argv.trim().split(/\s+/), deps.which)
      const launchPath = engine.launchArgv ? binaryPath(engine.launchArgv, deps.which) : null
      if (started === undefined || runningPath === null || launchPath === null) return
      try {
        const [running, current] = await Promise.all([deps.installation(runningPath), deps.installation(launchPath)])
        if (!running || !current) return
        const same = running.device === current.device && running.inode === current.inode
        if (same) {
          // A metadata change cannot establish whether the process loaded these bytes.
          if (current.changedAt < started - ETIME_SLACK_MS) out.set(key, false)
        } else if (
          running.path !== current.path &&
          running.createdAt > 0 &&
          running.createdAt < started - ETIME_SLACK_MS &&
          current.createdAt > started + ETIME_SLACK_MS
        ) {
          out.set(key, true)
        }
      } catch {
        // An unreadable installation is unknown, never evidence for replacement.
      }
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
  installation: async (path) => {
    try {
      const resolved = await realpath(path)
      const info = await stat(resolved)
      return { path: resolved, device: info.dev, inode: info.ino, changedAt: info.ctimeMs, createdAt: info.birthtimeMs }
    } catch {
      return null
    }
  },
  now: () => Date.now(),
}
