/**
 * Spawn a background child that must OUTLIVE this process (the daemon, the
 * PTY host). POSIX detaches with setsid and hands the log fd down; Windows
 * uses the PowerShell launcher in win-detached-launch.ts, falling back to a
 * plain spawn (that dies with us) only when the launcher can't run.
 */

import { type StdioOptions, spawn } from "node:child_process"
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs"
import { dirname } from "node:path"
import { spawnWindowsDetached } from "./win-detached-launch.ts"

/**
 * Plain-`spawn` detach options. POSIX: `detached` (setsid). Windows (fallback
 * only): `detached: true` would mean DETACHED_PROCESS, so every console child
 * (git, gh, PowerShell) pops a visible window, and Bun's job object kills it
 * on exit anyway; `windowsHide` shares this console and dies with it.
 */
export function detachOptions(
  platform: NodeJS.Platform = process.platform,
): { windowsHide: true } | { detached: true } {
  return platform === "win32" ? { windowsHide: true } : { detached: true }
}

/**
 * Spawn the detached daemon with stdout/stderr appended to `logPath`.
 *
 * Windows: the launcher is the only way the child survives this process's
 * exit (Bun's kill-on-close job) and the terminal's close. If it fails, spawn
 * directly and log that the child won't outlive us: better than no daemon.
 *
 * POSIX: hand the log fd down and close the parent's copy; `"ignore"` if the
 * log can't be opened (a log file never blocks startup).
 */
export function spawnDetachedDaemon(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
  } catch {
    /* the direct spawn below copes with a missing log dir */
  }
  if (platform === "win32") {
    const launcher = spawnWindowsDetached(command, args, env, logPath)
    const fallback = (reason: string) => {
      try {
        appendFileSync(
          logPath,
          `[${new Date().toISOString()}] rove: detached launcher ${reason} — spawning directly; this process will not outlive its parent\n`,
        )
      } catch {
        /* log is best-effort */
      }
      spawnDirect(command, args, env, logPath, platform)
    }
    launcher.once("error", (err) => fallback(`could not start (${err.message})`))
    launcher.once("exit", (code, signal) => {
      if (code !== 0) fallback(`exited ${code ?? signal}`)
    })
    return
  }
  spawnDirect(command, args, env, logPath, platform)
}

function spawnDirect(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
  platform: NodeJS.Platform,
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
  const child = spawn(command, [...args], { ...detachOptions(platform), stdio, env })
  child.unref()
  if (logFd !== undefined) {
    try {
      closeSync(logFd)
    } catch {
      /* parent's copy only — child holds its own dup */
    }
  }
}
