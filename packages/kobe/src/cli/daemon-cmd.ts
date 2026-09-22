/** `kobe daemon <command>` — daemon lifecycle. `argv` is already trimmed of the `daemon` verb. */

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

  // Accept-set shared with `kobe completions`, so every verb is completable.
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
      // Nothing running already satisfies "stop": exit 0, so a defensive
      // `daemon stop` in a teardown script doesn't fail.
      console.log(`${CLI_NAME} daemon: no daemon running at ${socketPath}`)
    } finally {
      client.close()
    }
    return
  }

  if (command === "restart") {
    // Respawn as a detached child, not in-process, or restart blocks the shell.
    // Reason `restart` is relayed to every attached TUI, so a client learns its
    // build is about to be stale before the socket drops.
    await stopDaemonProcess(socketPath, pidPath, { reason: "restart" })
    // Tagged so the new daemon's boot line tells restart from autospawn.
    const next = await connectOrStartDaemon("explicit-restart")
    next.close()
    console.log(`${CLI_NAME} daemon: restarted, listening on ${socketPath}`)
    return
  }

  // We ARE the daemon from here. `daemon.log` is an inherited append fd, so
  // boot — before the first byte — is the only rotation point.
  rotateLogIfNeeded(defaultDaemonLogPath())

  // Before any work, so a startup rejection is logged, not a silent death.
  // Only ever runs in the spawned daemon process, never the TUI or tests.
  installDaemonCrashHandlers()

  // First line: who asked (`explicit-restart`, `autospawn`, `manual`).
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
