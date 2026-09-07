/**
 * How a running Rove reloads its own CODE without the user quitting and
 * typing `rove` again.
 *
 * The daemon can be restarted from anywhere and comes back on whatever is on
 * disk; the TUI cannot — a `bun` process keeps executing the bundle it booted
 * with until it dies. So after `rove update` the client is the half that stays
 * behind, and the only honest fix is to start over as a new process.
 *
 * Lives in `cli/` beside {@link import("./invocation.ts")} for the same
 * reason: both answer "what argv runs this Rove", one for a subcommand child
 * and one for this process's replacement.
 *
 * The two pure halves — the plan and the argv — are the testable ones. The
 * third genuinely replaces the process, so it is a `never` with no seam a test
 * should ever cross.
 */

import { spawnSync } from "node:child_process"

/** What a refresh would do, or why it would do nothing. */
export type SelfRefreshPlan =
  /** This process runs from an install that no longer exists: relaunching it
   *  re-execs a file that is gone. Only reinstalling fixes this. */
  | { readonly kind: "unavailable"; readonly reason: "install-gone" }
  /** Daemon and client already agree — a refresh would cost live UI state
   *  and buy nothing. */
  | { readonly kind: "current" }
  /** Reload this process. `restartDaemon` says whether the daemon has to go
   *  first, or is already being replaced by whoever asked. */
  | { readonly kind: "refresh"; readonly restartDaemon: boolean }

export interface SelfRefreshInputs {
  /** The daemon's build version from `hello` / `daemon.stopping`; null while unknown. */
  readonly daemonVersion: string | null
  /** This process's own build (`CURRENT_VERSION`). */
  readonly clientVersion: string
  /** The reconnect loop's terminal error, latched — see `staleInstallSignal`. */
  readonly staleInstall: string | null
  /** A `daemon.stopping` frame claimed `reason: "restart"` — someone is
   *  already swapping the daemon's code. */
  readonly daemonRestarting: boolean
}

/**
 * Decide what a refresh does, from the three facts the client already has.
 * Pure — the whole point of the split, since every branch below ends in an
 * action no test may perform.
 *
 * Order is by what OUTRANKS what, not by likelihood:
 *
 * 1. A gone install beats everything. Relaunching would exec a deleted file,
 *    and the banner for it already says the only thing that works.
 * 2. A daemon already restarting means the client reloads ITSELF and nothing
 *    else — stopping a daemon someone is mid-way through replacing races the
 *    respawn onto the same socket for no gain.
 * 3. A version difference restarts both. Which side is stale is deliberately
 *    not asked (`isDaemonVersionStale` is a string inequality on purpose):
 *    both halves re-read from disk, so both converge on the installed build
 *    whichever one was behind.
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
 * The argv that starts this process again: the same runtime, the same runtime
 * FLAGS, the same entry, the same user arguments.
 *
 * `execArgv` is the half that is easy to drop and expensive to miss — a dev
 * run is `bun --conditions=browser src/cli/rove.ts`, and Bun keeps its own
 * flags out of `argv` entirely, so an argv rebuilt without them relaunches
 * into an opentui that resolves the wrong entry.
 *
 * Deliberately NOT `roveCliInvocation()`: that resolves the packaged `rove`
 * through PATH, which is a different question with a different answer (a
 * shim from another install, a shell alias). Re-running this process's own
 * entry file is what "reload my code" means — npm overwrote that file in
 * place, so the path is stable and its contents are new.
 */
export function selfRelaunchArgv(proc: RelaunchProcess): readonly string[] {
  return [proc.execPath, ...proc.execArgv, ...proc.argv.slice(1)]
}

/** Structural renderer handle — only `destroy()` matters here. */
export type DestroyableRenderer = { destroy(): void }

/**
 * Become the new Rove. Never returns.
 *
 * Two strategies, because only one of them exists everywhere:
 *
 * - POSIX: `process.execve` replaces the process image. Same pid, same
 *   terminal, no parent left holding a Bun runtime — the closest thing to
 *   what the user would get by quitting and retyping the command. It is an
 *   experimental API, hence the try/catch and the fallback below rather than a
 *   platform check: if a future runtime withdraws it, refreshing degrades to
 *   the spawn path instead of stranding the user in a destroyed renderer. Its
 *   one-line ExperimentalWarning lands on the main screen, which the successor
 *   leaves for the alternate screen a moment later.
 * - Windows (and any platform where execve is unavailable, which it announces
 *   by throwing): spawn the replacement with the terminal inherited and exit
 *   with its code once it is done. The old process lingers as an idle parent
 *   until the successor quits — the cost of the platform, not a choice, and
 *   the reason execve is preferred where it exists.
 *
 * The renderer is destroyed FIRST either way. A bare exec would leave mouse
 * tracking and the kitty keyboard protocol armed, and the successor inherits
 * that terminal — `destroy()` is what hands it back in a known state.
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
      // Unavailable on this platform (Windows says so by throwing) — fall
      // through to the spawn path rather than stranding the user in a
      // destroyed renderer.
    }
  }
  const result = spawnSync(command, args, { stdio: "inherit", env: opts.env ?? process.env })
  if (result.error) {
    process.stderr.write(`\nrove: could not relaunch (${result.error.message})\n`)
    process.exit(1)
  }
  process.exit(result.status ?? 0)
}
