/**
 * A running Rove reloading its own CODE. A `bun` process runs the bundle it
 * booted with until it dies, so after `rove update` the TUI must become a new
 * process (the daemon just restarts onto what's on disk).
 *
 * The plan and the argv are pure and tested; `relaunchSelf` really replaces
 * the process, so it is a `never` no test crosses.
 */

import { spawnSync } from "node:child_process"

/** What a refresh would do, or why it would do nothing. */
export type SelfRefreshPlan =
  /** The install this process runs from is gone; only reinstalling fixes it. */
  | { readonly kind: "unavailable"; readonly reason: "install-gone" }
  /** Versions agree — a refresh would only cost live UI state. */
  | { readonly kind: "current" }
  /** Reload; `restartDaemon` false when the daemon is already being replaced. */
  | { readonly kind: "refresh"; readonly restartDaemon: boolean }

export interface SelfRefreshInputs {
  /** The daemon's build version from `hello` / `daemon.stopping`; null while unknown. */
  readonly daemonVersion: string | null
  /** This process's own build (`CURRENT_VERSION`). */
  readonly clientVersion: string
  /** The reconnect loop's terminal error, latched — see `staleInstallSignal`. */
  readonly staleInstall: string | null
  /** A `daemon.stopping` frame said `reason: "restart"`. */
  readonly daemonRestarting: boolean
}

/**
 * Order is precedence, not likelihood:
 *
 * 1. A gone install beats everything (relaunch would exec a deleted file).
 * 2. Daemon already restarting → reload only the client; stopping it would
 *    race the respawn onto the same socket.
 * 3. Any version difference restarts both. Which side is stale is not asked:
 *    both re-read from disk and converge on the installed build.
 */
export function planSelfRefresh(inputs: SelfRefreshInputs): SelfRefreshPlan {
  if (inputs.staleInstall) return { kind: "unavailable", reason: "install-gone" }
  const stale = !!inputs.daemonVersion && inputs.daemonVersion !== inputs.clientVersion
  if (inputs.daemonRestarting) return { kind: "refresh", restartDaemon: false }
  if (stale) return { kind: "refresh", restartDaemon: true }
  return { kind: "current" }
}

/** The `process` fields {@link selfRelaunchArgv} reads — a fake in tests. */
export type RelaunchProcess = {
  readonly execPath: string
  readonly execArgv: readonly string[]
  readonly argv: readonly string[]
}

/**
 * Same runtime, runtime FLAGS, entry and user args. `execArgv` matters: a dev
 * run is `bun --conditions=browser src/cli/rove.ts` and Bun keeps its flags out
 * of `argv`, so dropping them resolves the wrong opentui entry.
 *
 * NOT `roveCliInvocation()`: PATH may resolve another install's shim or an
 * alias. npm overwrote this entry file in place, so re-running it loads the
 * new code.
 */
export function selfRelaunchArgv(proc: RelaunchProcess): readonly string[] {
  return [proc.execPath, ...proc.execArgv, ...proc.argv.slice(1)]
}

/** Structural renderer handle — only `destroy()` matters here. */
export type DestroyableRenderer = { destroy(): void }

/**
 * Become the new Rove. Never returns.
 *
 * - `process.execve` (POSIX): same pid and terminal, no idle parent. It is
 *   experimental, so it is try/caught rather than platform-checked; its
 *   ExperimentalWarning lands on the main screen, which the successor leaves.
 * - Otherwise (Windows throws): spawn with the terminal inherited and exit with
 *   its code; the old process idles as parent until the successor quits.
 *
 * The renderer is destroyed FIRST: otherwise the successor inherits a terminal
 * with mouse tracking and the kitty keyboard protocol still armed.
 */
export function relaunchSelf(opts: {
  readonly renderer: DestroyableRenderer | null | undefined
  /** Printed above the successor's first frame, so a relaunch is never silent. */
  readonly notice?: string
  readonly proc?: RelaunchProcess
  readonly env?: NodeJS.ProcessEnv
}): never {
  try {
    opts.renderer?.destroy()
  } catch (err) {
    console.error("Rove: renderer.destroy() failed during refresh:", err)
  }
  const argv = selfRelaunchArgv(opts.proc ?? process)
  const [command, ...args] = argv as [string, ...string[]]
  if (opts.notice) process.stdout.write(`\n${opts.notice}\n`)
  const execve = (process as { execve?: (path: string, argv: readonly string[], env: NodeJS.ProcessEnv) => never })
    .execve
  if (execve) {
    try {
      execve(command, argv, opts.env ?? process.env)
    } catch {
      // Unavailable here — fall through to spawn, not a destroyed renderer.
    }
  }
  const result = spawnSync(command, args, { stdio: "inherit", env: opts.env ?? process.env })
  if (result.error) {
    process.stderr.write(`\nrove: could not relaunch (${result.error.message})\n`)
    process.exit(1)
  }
  process.exit(result.status ?? 0)
}
