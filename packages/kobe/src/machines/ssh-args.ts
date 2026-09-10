/**
 * The `ssh` argv a machine connection uses — one builder, so the discovery
 * probe, the tunnel and any future call agree on the multiplexing options.
 *
 * Deliberately a sibling of `exec/exec-host.ts`'s `sshConnectArgs` rather than
 * a call into it: that one takes a `RemoteSpec` built for remote PROJECTS
 * (which carries a `basePath` and a lazily-fetched keychain password), and its
 * ControlPath lives under the remote-project tree. The FLAGS below are
 * deliberately the same set — `ControlMaster=auto` + `ControlPersist=300` +
 * TOFU host keys — because they encode the same decision, and this file is
 * where a machine's version of it is stated.
 */

import { tmpdir } from "node:os"
import { join } from "node:path"
import { shortHomeTag } from "@sma1lboy/kobe-daemon/daemon/paths"
import { homeDir } from "../env.ts"
import type { MachineConfig } from "./registry.ts"
import { sshTargetOf } from "./registry.ts"

/** How long a shared master outlives its last channel, in seconds. */
export const CONTROL_PERSIST_SECONDS = 300

/**
 * `<home>/.rove/machines/<alias>` — holds the control socket and both
 * forwarded sockets. Owner-only; created by the tunnel.
 *
 * Falls back to a short `$TMPDIR` directory when the natural path would put a
 * socket past the kernel's `sun_path` limit — a real case, not a theoretical
 * one: a Rove home inside a worktree (`~/.rove/worktrees/<name>/…`) already
 * spends 60 of the ~104 bytes before `machines/<alias>/daemon.sock` starts,
 * and ssh's own refusal reads `ControlPath too long`, which names neither the
 * machine nor the remedy. Keyed on home + alias via the same
 * {@link shortHomeTag} the daemon's sockets use, so the fallback path is the
 * SAME string every time — a client that computed a different one would look
 * for the forward in the wrong place.
 */
export function machineSocketDir(alias: string, home = homeDir()): string {
  const natural = join(home, ".rove", "machines", alias)
  // The longest name this directory has to hold. Measuring the DIRECTORY
  // against the limit would pass and then fail on the socket inside it.
  if (Buffer.byteLength(join(natural, "daemon.sock"), "utf8") <= SOCKET_PATH_LIMIT) return natural
  return join(tmpdir(), `rove-m-${shortHomeTag(home)}-${shortHomeTag(alias)}`)
}

/**
 * Budget for a unix socket path. `sun_path` is 104 bytes on macOS and 108 on
 * Linux; the daemon's own paths use 100 as the safe floor and so does this.
 */
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
export function controlPath(alias: string, home = homeDir()): string {
  return join(machineSocketDir(alias, home), "cm")
}

/**
 * Connection flags shared by every machine ssh invocation — no remote command,
 * no target. `batch` (the default) fails fast instead of prompting, which is
 * required for anything the daemon or a reconnect loop runs unattended.
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
