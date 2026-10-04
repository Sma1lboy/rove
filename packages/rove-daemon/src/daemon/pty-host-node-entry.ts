/**
 * The Windows PTY host, as its own NODE program: Bun rejects its `terminal`
 * spawn option there, and a Bun-hosted node-pty session can be read but not
 * written (ConPTY input pipe → `ERR_SOCKET_CLOSED`). Same `startPtyHostServer`
 * with the node-pty driver injected; clients speak the same frames over a
 * named pipe.
 *
 * Bundled to a node target; nothing here may touch a Bun global.
 */

import { rotateLogIfNeeded } from "./log-rotate.ts"
import { defaultPtyHostLogPath } from "./paths.ts"
import { nodePtyDriver } from "./pty-driver.ts"
import { formatPtyHostLine } from "./pty-host-log.ts"
import { startPtyHostServer } from "./pty-server.ts"

async function main(): Promise<void> {
  // Same log, same inherited-append-fd constraint as the Bun host in
  // `cli/pty-host-cmd.ts`: boot is the only safe rotation point.
  rotateLogIfNeeded(defaultPtyHostLogPath())

  // Not installDaemonCrashHandlers(): that module is Bun-side.
  process.on("uncaughtException", (err) => console.error(formatPtyHostLine("crash", err?.stack ?? String(err))))
  process.on("unhandledRejection", (err) => console.error(formatPtyHostLine("reject", String(err))))

  const driver = await nodePtyDriver()
  const server = await startPtyHostServer({
    driver,
    log: (event, message) => console.log(formatPtyHostLine(event, message)),
    // Windows spawns this host from a bundle that cannot see the CLI's
    // package.json; the spawner stamps the version it is serving instead.
    version: process.env.ROVE_PTY_HOST_VERSION,
    onStop: () => process.exit(0),
  })
  console.log(formatPtyHostLine("listen", `node host listening on ${server.socketPath}`))

  const shutdown = async (): Promise<void> => {
    await server.close()
    process.exit(0)
  }
  process.once("SIGINT", () => void shutdown())
  process.once("SIGTERM", () => void shutdown())
}

await main()
