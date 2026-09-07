/**
 * Spawning a background child that must OUTLIVE this process — the daemon
 * (`rove daemon start`) and the PTY host (`rove pty-host`). Owns the
 * platform split: POSIX detaches with setsid and hands the log fd down;
 * Windows goes through the PowerShell launcher in win-detached-launch.ts,
 * falling back to a plain spawn (that dies with us) only when the launcher
 * itself cannot run. Reachability, probing and the spawn+poll loops stay in
 * daemon-process.ts / pty-process.ts.
 */

import { type StdioOptions, spawn } from "node:child_process"
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs"
import { dirname } from "node:path"
import { spawnWindowsDetached } from "./win-detached-launch.ts"

/**
 * How a background child is cut loose from this process by a plain
 * `child_process.spawn`.
 *
 * POSIX: `detached` (setsid) is the whole answer. Windows: this is only the
 * FALLBACK shape, used when the real launcher (win-detached-launch.ts)
 * could not run. `detached: true` there means DETACHED_PROCESS — no console
 * at all, so every console child the daemon spawns (git, gh, PowerShell
 * probes) pops a visible window — and it would not save the child anyway:
 * Bun's job object kills it when this process exits. `windowsHide` keeps
 * the windows away; the child then shares this console and dies with it.
 */
export function detachOptions(
  platform: NodeJS.Platform = process.platform,
): { windowsHide: true } | { detached: true } {
  return platform === "win32" ? { windowsHide: true } : { detached: true }
}

/**
 * Spawn the detached daemon child with stdout/stderr appended to
 * `logPath`, so a crash leaves a trace.
 *
 * Windows goes through the PowerShell launcher in win-detached-launch.ts —
 * the only way the child survives this process's exit (Bun's kill-on-close
 * job) and this terminal's close (its own hidden console); see that file.
 * Should the launcher itself fail, the child is spawned directly instead,
 * with a line in the log saying it will not outlive this process: a daemon
 * that dies with its TUI beats no daemon.
 *
 * POSIX: the parent opens the log and hands the fd down, closing its own
 * copy after the fork; falls back to `"ignore"` if the log file can't be
 * opened (never block the daemon from starting over a log file).
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
