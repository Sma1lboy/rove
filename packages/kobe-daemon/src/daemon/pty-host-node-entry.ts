/**
 * The Windows PTY host, as its own NODE program.
 *
 * Everywhere else the PTY host is `kobe pty-host` running under Bun. Windows
 * cannot be: Bun rejects its `terminal` spawn option there outright, and a
 * Bun-hosted node-pty session can be read but not written to (the ConPTY
 * input pipe comes back `ERR_SOCKET_CLOSED`). So on Windows the same
 * `startPtyHostServer` — same sessions, same ring buffer, same wire protocol —
 * runs under node with the node-pty driver injected.
 *
 * Bundled to a node target at build time; nothing here may touch a Bun global.
 * Clients are unaffected: they still speak the daemon frame grammar, just over
 * a named pipe instead of a unix socket (see paths.ts).
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

  // No installDaemonCrashHandlers(): that lives in the Bun-side crash-log
  // module. Keep the net local and dependency-free so this entry stays
  // node-clean.
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
