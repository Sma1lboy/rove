/**
 * Automation precheck: a cheap shell command run BEFORE the engine starts,
 * whose exit code decides whether a scheduled run is worth an engine turn.
 *
 * Contract: exit 0 ⇒ proceed; non-zero, timeout or spawn failure ⇒ SKIP.
 * Fails closed so a broken precheck can't degrade into "run every time". The
 * skip is recorded with its output so a broken command is distinguishable
 * from a healthy "nothing to do".
 *
 * Runs via the login shell with `-ilc`, as `session-launch.ts` spawns engine
 * tabs: the interactive bit sources `.zshrc`/`.bashrc`, so the precheck sees
 * the engine's environment. Rc output rides along in the streams; the exit
 * code is the only signal and the timeout bounds a slow rc.
 * `resolveLoginShell` yields a bash even on Windows (Git Bash — see its WSL
 * caveat), so `-ilc` is portable.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import type { AutomationPrecheck, AutomationPrecheckResult } from "./contracts.ts"
import { resolveLoginShell } from "./platform-shell.js"

/** Per-stream capture cap. Kept small — this is a decision signal, not a log. */
const MAX_OUTPUT_CHARS = 4000

/** Upper bound on a user-supplied timeout, so a typo can't wedge the sweep. */
const MAX_TIMEOUT_SECONDS = 600

/**
 * SIGKILL the shell's process group (its children, e.g. `gh pr list | grep …`,
 * would survive a pid-only kill), falling back to the shell alone — all
 * Windows, which has no groups, can reach.
 */
function killGroup(child: ReturnType<typeof spawn>): void {
  const pid = child.pid
  if (pid === undefined) return
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      child.kill("SIGKILL")
    } catch {
      // Already reaped — nothing to signal.
    }
  }
}

/**
 * Make the SHELL enforce the timeout on itself. The Node timer dies with a
 * SIGKILLed daemon, leaving the shell running: `while [ ! -f release ]; do
 * sleep 0.01; done` spins at ~100 forks/s until reboot — 33 such orphans held
 * a Mac at load 170 with 86% CPU in the kernel.
 *
 * `set +m` disables job control so the watchdog neither prints `[1] 12345`
 * into stderr nor gets its own process group (escaping the group kill). The
 * EXIT trap reaps it when the command finishes first; POSIX keeps a trap from
 * changing the exit status.
 *
 * The watchdog gets its own stdio: otherwise it holds the captured pipes, Node
 * fires `close` only when every writer lets go, and a fast precheck would wait
 * out the whole `sleep` — the timeout a floor instead of a ceiling.
 */
export function withWatchdog(command: string, timeoutSeconds: number): string {
  return [
    "set +m 2>/dev/null",
    `{ sleep ${timeoutSeconds} && { kill -9 -$$ 2>/dev/null || kill -9 $$ ; } ; } >/dev/null 2>&1 </dev/null &`,
    "__rove_watchdog=$!",
    `trap 'kill "$__rove_watchdog" 2>/dev/null' EXIT`,
    command,
  ].join("\n")
}

/**
 * Decode chunks, keeping the last `MAX_OUTPUT_CHARS`. Concatenate bytes and
 * decode once: `data` events split at arbitrary byte offsets, and per-chunk
 * decoding turns a straddling multi-byte sequence into `�` (our own pushed
 * strings round-trip unchanged). Cap by code points so the slice can't strand
 * a lone surrogate.
 */
export function tail(chunks: readonly (Buffer | string)[]): string {
  const text = Buffer.concat(chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : c))).toString("utf8")
  // `text.length` (UTF-16 units) >= code-point count, so an under-cap string
  // is safe as-is; only pay for the code-point split when over.
  if (text.length <= MAX_OUTPUT_CHARS) return text
  const points = Array.from(text)
  return points.length <= MAX_OUTPUT_CHARS ? text : points.slice(-MAX_OUTPUT_CHARS).join("")
}

/** Run `precheck.command` in `cwd`. Never throws: a spawn failure resolves as a non-passing result. */
export function runAutomationPrecheck(
  precheck: AutomationPrecheck,
  cwd: string,
  shell = resolveLoginShell({ fallback: "/bin/sh" }),
): Promise<AutomationPrecheckResult> {
  const startedAt = Date.now()
  const timeoutMs = Math.min(Math.max(precheck.timeoutSeconds, 1), MAX_TIMEOUT_SECONDS) * 1000

  // A missing cwd surfaces as `spawn <shell> ENOENT`, which misreads as a broken shell.
  if (!existsSync(cwd)) {
    return Promise.resolve({
      exitCode: null,
      timedOut: false,
      stdout: "",
      stderr: `working directory does not exist: ${cwd}`,
      durationMs: 0,
    })
  }

  return new Promise((resolve) => {
    const out: (Buffer | string)[] = []
    const err: (Buffer | string)[] = []
    let settled = false
    // Tells "hangs" from "broken" when there is no exit code.
    let timedOut = false

    const finish = (exitCode: number | null, timedOut: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        exitCode,
        timedOut,
        stdout: tail(out),
        stderr: tail(err),
        durationMs: Date.now() - startedAt,
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      if (child) killGroup(child)
      // Settle now: an unreachable shell might never emit `close`.
      finish(null, true)
    }, timeoutMs)
    timer.unref?.()

    let child: ReturnType<typeof spawn> | undefined
    try {
      // +1s so a live daemon's timer wins and reports a timeout, not a bare signal death.
      child = spawn(shell, ["-ilc", withWatchdog(precheck.command, timeoutMs / 1000 + 1)], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        // Own process group, so a timeout kills the command's children too.
        detached: process.platform !== "win32",
      })
    } catch (spawnError) {
      // A bad shell path throws synchronously; same verdict as a bad exit.
      err.push(spawnError instanceof Error ? spawnError.message : String(spawnError))
      finish(null, false)
      return
    }

    child.stdout?.on("data", (chunk: Buffer | string) => out.push(chunk))
    child.stderr?.on("data", (chunk: Buffer | string) => err.push(chunk))
    child.on("error", (spawnError) => {
      if (timedOut) {
        finish(null, true)
        return
      }
      err.push(spawnError.message)
      finish(null, false)
    })
    child.on("close", (code) => finish(code, timedOut))
  })
}

/** Exit 0 and nothing else means "there is work to do". */
export function precheckPassed(result: AutomationPrecheckResult): boolean {
  return result.exitCode === 0 && !result.timedOut
}

/** One-line reason for the run record. */
export function formatPrecheckSkip(result: AutomationPrecheckResult): string {
  if (result.timedOut) return `precheck timed out after ${result.durationMs}ms`
  if (result.exitCode === null) return `precheck could not run: ${result.stderr.trim() || "unknown error"}`
  return `precheck exited ${result.exitCode}`
}
