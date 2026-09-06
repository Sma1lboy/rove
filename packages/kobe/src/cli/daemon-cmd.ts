/**
 * `kobe daemon <command>` — daemon lifecycle subcommands.
 *
 * Ported from the now-removed `kobed` bin. The body is the same
 * logic with a different argv shape: the dispatcher in `cli/index.ts`
 * passes `rest` already trimmed of the `daemon` verb, so we read the
 * sub-command at `argv[0]` instead of `argv[2]`.
 */

import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { connectOrStartDaemon, daemonSpawnReason } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { installDaemonCrashHandlers, logDaemonInfo } from "@sma1lboy/kobe-daemon/daemon/crash-log"
import { stopDaemonProcess } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import { rotateLogIfNeeded } from "@sma1lboy/kobe-daemon/daemon/log-rotate"
import { defaultDaemonLogPath, defaultDaemonPidPath, defaultDaemonSocketPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { readPidFile, startDaemonServer } from "@sma1lboy/kobe-daemon/daemon/server"
import { daemonRuntime } from "../core/daemon-runtime.ts"
import { type KobeCore, createKobeCore } from "../core/index.ts"
import { sweepIndexLeftovers } from "../orchestrator/index/sweep.ts"
import { migrateRoveDaemonStateLayout } from "../state/layout-migration.ts"
import { CURRENT_VERSION } from "../version.ts"
import { resolvePluginBinPath } from "./plugin-bin-path.ts"
import { activeCliName } from "./rename-compat.ts"
import { SUBCOMMAND_VERBS } from "./subcommands.ts"

const CLI_NAME = activeCliName()

function printDaemonUsage(out: Pick<typeof process.stderr, "write">): void {
  out.write(
    [
      `Usage: ${CLI_NAME} daemon <command>`,
      "",
      "Commands:",
      "  status     Print the running daemon's status JSON (default)",
      "  start      Run the daemon in the foreground (this process becomes it)",
      "  stop       Ask the running daemon to shut down",
      "  restart    Stop the daemon (graceful → SIGTERM → SIGKILL) and respawn it",
      "",
    ].join("\n"),
  )
}

export async function runDaemonSubcommand(argv: readonly string[]): Promise<void> {
  const [command = "status"] = argv
  const socketPath = defaultDaemonSocketPath()
  const pidPath = defaultDaemonPidPath()

  if (command === "--help" || command === "-h" || command === "help") {
    printDaemonUsage(process.stdout)
    return
  }

  // The accept-set lives in `subcommands.ts` so `kobe completions` offers
  // exactly what this dispatch runs; a verb added below but not there is
  // rejected here rather than becoming an uncompletable secret.
  if (!SUBCOMMAND_VERBS.daemon.includes(command)) {
    process.stderr.write(`${CLI_NAME} daemon: unknown command "${command}"\n\n`)
    printDaemonUsage(process.stderr)
    process.exit(2)
  }

  if (command === "status") {
    const client = new KobeDaemonClient(socketPath)
    try {
      const status = await client.request<Record<string, unknown>>("daemon.status")
      console.log(JSON.stringify(status, null, 2))
    } catch {
      const pid = await readPidFile(pidPath)
      if (pid) console.log(`${CLI_NAME} daemon: no daemon socket at ${socketPath} (stale pidfile pid=${pid})`)
      else console.log(`${CLI_NAME} daemon: no daemon running at ${socketPath}`)
      process.exitCode = 1
    } finally {
      client.close()
    }
    return
  }

  if (command === "stop") {
    const client = new KobeDaemonClient(socketPath)
    try {
      await client.request("daemon.stop")
      console.log(`${CLI_NAME} daemon: stop requested`)
    } catch {
      // No daemon answering the socket → "stop" is already satisfied. Report
      // it cleanly and exit 0 (a defensive `daemon stop` in a teardown script
      // must not fail just because nothing was running) rather than letting
      // the connection error bubble to the top-level "failed to start" catch.
      console.log(`${CLI_NAME} daemon: no daemon running at ${socketPath}`)
    } finally {
      client.close()
    }
    return
  }

  if (command === "restart") {
    // Stop + confirm-dead + unlink socket/pidfile via the shared
    // escalation helper, then respawn. Spawn the new daemon as
    // a detached child instead of becoming it ourselves — otherwise
    // `kobe daemon restart` blocks the shell forever and looks "hung" to
    // anyone running it interactively.
    // `restart`, not the default `stop`: the outgoing daemon relays it to
    // every attached TUI, which is how a running client learns its own build
    // is about to be the stale one — before the socket even drops.
    await stopDaemonProcess(socketPath, pidPath, { reason: "restart" })
    // Tag the respawn. The restart path and an idle helper's autospawn go
    // through the same spawn, so without this the new daemon's boot line
    // cannot say which one it was — and "did my restart end those sessions?"
    // has no answer in the log.
    const next = await connectOrStartDaemon("explicit-restart")
    next.close()
    console.log(`${CLI_NAME} daemon: restarted, listening on ${socketPath}`)
    return
  }

  // We ARE the daemon process from here on. `daemon.log` is stdout/stderr
  // inherited from the parent's `spawnDetachedDaemon` open (an append fd,
  // not routed through any in-process writer here) — the only rotation
  // point that can cover it is boot, before the daemon writes a single
  // byte. One generation kept (`daemon.log.old`); see log-rotate.ts.
  rotateLogIfNeeded(defaultDaemonLogPath())

  // Install the crash net before doing any work so a stray rejection
  // during startup (or any time after) is logged to daemon.log instead of
  // silently killing the daemon. Safe here because this branch only runs
  // in the spawned daemon process, never in the TUI or tests.
  installDaemonCrashHandlers()

  // First line this daemon writes: who asked for it. `explicit-restart` is a
  // `rove daemon restart`, `autospawn` a client that found no daemon
  // answering, `manual` a `rove daemon start` typed by hand.
  logDaemonInfo("boot", `daemon starting — ${daemonSpawnReason()} (pid ${process.pid}, v${CURRENT_VERSION})`)

  let core: KobeCore | undefined
  const server = await startDaemonServer(
    async () => {
      const migration = migrateRoveDaemonStateLayout()
      for (const warning of migration.warnings) console.error(`[rove] daemon state migration will retry: ${warning}`)
      core = await createKobeCore()
      const swept = sweepIndexLeftovers(core.store.stateDir)
      if (swept.lock || swept.tmp.length > 0) {
        console.error(
          `[rove] swept crash leftovers in ${core.store.stateDir}: ` +
            `${swept.tmp.length} orphaned staging file(s) (${swept.tmpBytes} bytes)` +
            `${swept.lock ? ", stale task-index lockfile" : ""}`,
        )
      }
      return core.orchestrator
    },
    {
      runtime: daemonRuntime,
      socketPath,
      pidPath,
      // Plugin callbacks exec THIS Rove where that is expressible as one
      // absolute path, else the invoked name on PATH (see plugin-bin-path.ts).
      plugins: { binPath: resolvePluginBinPath() },
      onStop: async () => {
        await core?.close()
      },
    },
  )
  console.log(`${CLI_NAME} daemon: listening on ${server.socketPath}`)

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.once("SIGINT", () => void shutdown())
  process.once("SIGTERM", () => void shutdown())
}
