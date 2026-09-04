/**
 * Launcher for the capture stack — one `bun run dev` brings up:
 *   - the PTY sidecar (node, because node-pty only works there) on KOBE_PTY_PORT
 *   - the Vite dev server on KOBE_WEB_PORT, serving `/harness` and proxying /pty
 *
 * `/harness` is the only page: xterm.js over that sidecar, running the real
 * OpenTUI. It is the one ground-truth surface for visual acceptance
 * (docs/HARNESS.md). The daemon is started because the TUI inside the PTY
 * talks to it over the unix socket, not because this stack serves its data.
 * Ctrl-C tears everything down.
 *
 * Daemon isolation: `bun run dev` connects to whatever the default socket
 * points to — your production daemon with `~/.rove` product data.
 * `bun run dev:sandbox` sets `KOBE_HOME_DIR` to a throwaway home so the PTY
 * engines and services use a sandbox and never touch production `tasks.json`.
 * The banner below always prints which home this session is wired to.
 */

import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { ensureDaemonReachable } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { readRoveEnv, setRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { defaultWebTokenPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { ensureWebToken } from "@sma1lboy/kobe-daemon/daemon/web-token"

const WEB_PORT = readRoveEnv("WEB_PORT") ?? "5173"
const PTY_PORT = readRoveEnv("PTY_PORT") ?? "5175"

// Resolve KOBE_HOME_DIR to an absolute path so every child agrees on the same
// home regardless of its cwd, and ensure it exists (the sandbox home may not
// yet). Unset → production `~/.rove` product data (daemon runtime stays `.kobe`).
const rawHome = readRoveEnv("HOME_DIR")
const homeDir = rawHome ? resolve(rawHome) : null
if (homeDir) mkdirSync(homeDir, { recursive: true })
if (homeDir) setRoveEnv("HOME_DIR", homeDir)
setRoveEnv("WEB_PORT", WEB_PORT)
setRoveEnv("PTY_PORT", PTY_PORT)
const childEnv = { ...process.env }

const sandboxed = homeDir !== null
console.log(
  `\x1b[1m[rove web dev]\x1b[0m ${sandboxed ? "\x1b[33msandbox\x1b[0m" : "\x1b[31mPRODUCTION\x1b[0m"} · home: ${homeDir ?? `${homedir()}/.rove (production)`}`,
)
console.log(`  web :${WEB_PORT}  pty :${PTY_PORT}`)

await ensureDaemonReachable()

// The PTY sidecar's WebSocket requires a bearer token, and Vite serves the
// page, so `VITE_*` is the only channel the browser has for it. Mints the file
// if it is absent; the sidecar reads the same one.
const webToken = ensureWebToken(defaultWebTokenPath())

// node: PTY terminal server — node-pty only works under node, not bun.
const pty = Bun.spawn(["node", "pty-server.mjs"], {
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...childEnv, KOBE_PTY_PORT: PTY_PORT },
})

// node (via vite): the capture page, proxying /pty to the sidecar above.
const vite = Bun.spawn(["bun", "run", "vite", "dev", "--port", WEB_PORT, "--strictPort"], {
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    ...childEnv,
    KOBE_PTY_PORT: PTY_PORT,
    VITE_ROVE_WEB_TOKEN: webToken,
  },
})

const shutdown = (): void => {
  pty.kill()
  vite.kill()
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
process.on("exit", shutdown)

// If any child exits, bring the whole dev session down.
void Promise.race([pty.exited, vite.exited]).then(() => {
  shutdown()
  process.exit(0)
})
