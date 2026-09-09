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

import { join } from "node:path"
import { homeDir } from "../env.ts"
import type { MachineConfig } from "./registry.ts"
import { sshTargetOf } from "./registry.ts"

/** How long a shared master outlives its last channel, in seconds. */
export const CONTROL_PERSIST_SECONDS = 300

/** `<home>/.rove/machines/<alias>` — holds the control socket and both
 *  forwarded sockets. Owner-only; created by the tunnel. */
export function machineSocketDir(alias: string, home = homeDir()): string {
  return join(home, ".rove", "machines", alias)
}

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

/**
 * The two `-L` forwards that make a remote daemon reachable as a local socket.
 * Local-socket-to-remote-socket forwarding (`-L /local:/remote`) is an OpenSSH
 * 6.7+ feature; it is what lets both ends stay unix sockets, so neither daemon
 * ever opens a TCP port.
 *
 * `ExitOnForwardFailure=yes` is load-bearing: without it a forward that cannot
 * bind leaves ssh running and healthy-looking while the socket it was supposed
 * to create does not exist, and the machine reads as online forever.
 */
export function tunnelArgs(args: {
  readonly alias: string
  readonly config: MachineConfig
  readonly remoteDaemonSocket: string
  readonly remotePtySocket: string
  readonly home?: string
}): string[] {
  const argv = machineSshArgs(args.alias, args.config, { home: args.home })
  argv.splice(
    1,
    0,
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
  )
  const daemonLocal = localDaemonSocketPath(args.alias, args.home)
  const ptyLocal = localPtySocketPath(args.alias, args.home)
  // Insert the forwards before the target (the last element).
  argv.splice(argv.length - 1, 0, "-L", `${daemonLocal}:${args.remoteDaemonSocket}`)
  argv.splice(argv.length - 1, 0, "-L", `${ptyLocal}:${args.remotePtySocket}`)
  return argv
}
