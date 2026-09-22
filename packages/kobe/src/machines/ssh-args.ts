/**
 * The `ssh` argv a machine connection uses — one builder, so the discovery
 * probe, the tunnel and any future call agree on the multiplexing options.
 *
 * Not a call into `exec/exec-host.ts`'s `sshConnectArgs`: that takes a
 * remote-PROJECT `RemoteSpec` (`basePath`, keychain password) and keeps its
 * ControlPath under the remote-project tree. The flags are deliberately the
 * same set (`ControlMaster=auto`, `ControlPersist=300`, TOFU host keys).
 */

import { tmpdir } from "node:os"
import { join } from "node:path"
import { shortHomeTag } from "@sma1lboy/kobe-daemon/daemon/paths"
import { homeDir } from "../env.ts"
import type { MachineConfig } from "./registry.ts"
import { sshTargetOf } from "./registry.ts"

/** How long a shared master outlives its last channel, in seconds. */
const CONTROL_PERSIST_SECONDS = 300

/**
 * `<home>/.rove/machines/<alias>` — holds the control socket and both
 * forwarded sockets. Owner-only; created by the tunnel.
 *
 * Falls back to a short `$TMPDIR` dir when a socket would pass the `sun_path`
 * limit: a Rove home inside a worktree already spends ~60 of ~104 bytes, and
 * ssh's refusal (`ControlPath too long`) names neither machine nor remedy.
 * Keyed on home + alias via {@link shortHomeTag} so every client computes the
 * same fallback path.
 */
export function machineSocketDir(alias: string, home = homeDir()): string {
  const natural = join(home, ".rove", "machines", alias)
  // Measure the longest socket inside, not the directory itself.
  if (Buffer.byteLength(join(natural, "daemon.sock"), "utf8") <= SOCKET_PATH_LIMIT) return natural
  return join(tmpdir(), `rove-m-${shortHomeTag(home)}-${shortHomeTag(alias)}`)
}

/** Unix socket path budget: `sun_path` is 104 bytes on macOS, 108 on Linux; 100 matches the daemon's floor. */
const SOCKET_PATH_LIMIT = 100

/** The local end of the forwarded DAEMON socket for a machine. */
export function localDaemonSocketPath(alias: string, home = homeDir()): string {
  return join(machineSocketDir(alias, home), "daemon.sock")
}

/** The local end of the forwarded PTY-HOST socket for a machine. */
export function localPtySocketPath(alias: string, home = homeDir()): string {
  return join(machineSocketDir(alias, home), "pty.sock")
}

/** ControlMaster socket. Kept beside the forwarded sockets so removing a
 *  machine's directory tears down every file the connection owns. */
function controlPath(alias: string, home = homeDir()): string {
  return join(machineSocketDir(alias, home), "cm")
}

/**
 * ssh argv shared by every machine invocation, ending at the target (no remote
 * command). `batch` (default) fails fast instead of prompting — required for
 * anything run unattended.
 */
export function machineSshArgs(
  alias: string,
  config: MachineConfig,
  opts: { readonly home?: string; readonly batch?: boolean } = {},
): string[] {
  const argv = ["ssh"]
  if (opts.batch !== false) argv.push("-o", "BatchMode=yes")
  argv.push(
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${controlPath(alias, opts.home)}`,
    "-o",
    `ControlPersist=${CONTROL_PERSIST_SECONDS}`,
    // TOFU: accept an unknown host key on first connect, reject a CHANGED one.
    "-o",
    "StrictHostKeyChecking=accept-new",
  )
  if (config.port) argv.push("-p", String(config.port))
  if (config.auth.kind === "key" && config.auth.keyPath) argv.push("-i", config.auth.keyPath)
  argv.push(sshTargetOf(config))
  return argv
}
