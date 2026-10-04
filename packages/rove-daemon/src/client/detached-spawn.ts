/**
 * Spawn a background child that must OUTLIVE this process (the daemon, the
 * PTY host). POSIX detaches with setsid and hands the log fd down; Windows
 * uses the PowerShell launcher in win-detached-launch.ts, falling back to a
 * plain spawn (that dies with us) only when the launcher can't run.
 *
 * From inside a hosted session on Windows (its Job Object, daemon/win-pty-job.ts)
 * a launch of THIS Rove instance goes through the tab's PTY host instead, the
 * one process outside the job; anything else stays in the tab's job.
 */

import { type StdioOptions, spawn } from "node:child_process"
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs"
import { dirname } from "node:path"
import { defaultDaemonSocketPath, defaultPtyHostSocketPath } from "../daemon/paths.ts"
import { ptyJobLaunch, withoutPtyJob } from "../daemon/win-pty-job.ts"
import { RoveDaemonClient } from "./index.ts"
import { spawnWindowsDetached } from "./win-detached-launch.ts"

/** The host answers at once; an unreachable one falls back to the launcher. */
const ESCAPE_REQUEST_TIMEOUT_MS = 5_000

function appendLaunchLog(logPath: string, line: string): void {
  try {
    appendFileSync(logPath, `[${new Date().toISOString()}] rove: ${line}\n`)
  } catch {
    /* log is best-effort */
  }
}

/**
 * Ask the tab's PTY host to launch `command` detached. Rejects when it can't
 * (host down, an older host without the verb, timeout).
 */
async function launchViaPtyHost(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
  socketPath: string,
): Promise<void> {
  const client = new RoveDaemonClient(socketPath)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      client.request("spawn.detached", { command, args: [...args], env, logPath }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), ESCAPE_REQUEST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    client.close()
  }
}

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
    if (ptyJobLaunch(env, defaultDaemonSocketPath())?.mode === "escape") {
      const free = withoutPtyJob(env)
      launchViaPtyHost(command, args, free, logPath, defaultPtyHostSocketPath()).catch((err: Error) => {
        // The launcher still runs, but the child stays in the tab's job.
        appendLaunchLog(logPath, `PTY host could not launch outside the tab (${err.message}) — it ends with the tab`)
        launchWindowsDetached(command, args, free, logPath, platform)
      })
      return
    }
    launchWindowsDetached(command, args, env, logPath, platform)
    return
  }
  spawnDirect(command, args, env, logPath, platform)
}

function launchWindowsDetached(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
  platform: NodeJS.Platform,
): void {
  const launcher = spawnWindowsDetached(command, args, env, logPath)
  const fallback = (reason: string) => {
    appendLaunchLog(
      logPath,
      `detached launcher ${reason} — spawning directly; this process will not outlive its parent`,
    )
    spawnDirect(command, args, env, logPath, platform)
  }
  launcher.once("error", (err) => fallback(`could not start (${err.message})`))
  launcher.once("exit", (code, signal) => {
    if (code !== 0) fallback(`exited ${code ?? signal}`)
  })
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
