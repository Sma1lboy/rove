/**
 * The stdio transport: this machine serves the machine's two local sockets
 * itself, and pipes each connection through its own `ssh <target> rove daemon
 * relay [--pty]`. Nothing on either side needs SSH unix-socket forwarding, so
 * it works from a native Windows hub (OpenSSH for Windows has none) and to a
 * host whose sshd refuses `streamlocal`.
 *
 * Every client connection is one ssh session; the shared ControlMaster in
 * `machineSshArgs` makes the second and later ones cheap.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { type Server, createServer } from "node:net"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { logClientError } from "@sma1lboy/rove-daemon/client/client-log"
import { remoteRove } from "./discover.ts"
import type { MachineConfig } from "./registry.ts"
import { PreambleStripper } from "./relay-preamble.ts"
import { localDaemonSocketPath, localPtySocketPath, machineSocketDir, machineSshArgs } from "./ssh-args.ts"
import { isWindowsMachine } from "./windows-remote.ts"

/**
 * Hubs that cannot use `ssh -L sock:sock`, machines whose sockets ssh cannot
 * forward (a Windows daemon socket, a named-pipe PTY host), or anyone who asks.
 */
export function useStdioTransport(
  platform: NodeJS.Platform = process.platform,
  machine: Pick<MachineConfig, "sockets" | "roveBin"> = {},
): boolean {
  return platform === "win32" || process.env.ROVE_MACHINE_TRANSPORT === "stdio" || isWindowsMachine(machine)
}

/** The remote command one relay runs, with the machine's own Rove when discovery found one off PATH. */
export function relayCommand(machine: Pick<MachineConfig, "roveBin" | "relayPreamble">, pty: boolean): string {
  const flags = [...(pty ? ["--pty"] : []), ...(machine.relayPreamble ? ["--preamble"] : [])]
  return remoteRove(machine.roveBin, ["daemon", "relay", ...flags])
}

const servers = new Map<string, Server>()

function serve(path: string, argv: readonly string[], preamble: boolean): Promise<void> {
  if (servers.has(path)) return Promise.resolve()
  const server = createServer((conn) => {
    const [cmd, ...args] = argv
    const child: ChildProcess = spawn(cmd ?? "ssh", args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
    conn.pipe(child.stdin as NodeJS.WritableStream)
    const end = () => {
      conn.destroy()
      child.kill()
    }
    if (preamble) {
      const stripper = new PreambleStripper()
      child.stdout?.on("data", (chunk: Buffer) => {
        const out = stripper.push(chunk)
        if (out === null) end()
        else if (out.length > 0) conn.write(out)
      })
    } else {
      child.stdout?.pipe(conn)
    }
    conn.on("close", () => child.kill())
    conn.on("error", end)
    child.on("exit", () => conn.end())
    child.on("error", (err) => {
      logClientError("machines", err)
      end()
    })
  })
  servers.set(path, server)
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      servers.delete(path)
      reject(err)
    })
    // A previous run's socket file would make listen fail with EADDRINUSE.
    rmSync(path, { force: true })
    // Open connections keep a process alive; an idle relay must not keep a one-shot CLI from exiting.
    server.unref()
    server.listen(path, () => resolve())
  })
}

/**
 * Whether the machine's daemon answers through the relay. The local socket
 * always accepts (this process serves it), so only a `hello` that crosses ssh
 * says the far end is there.
 */
export async function relayAnswers(alias: string, home?: string): Promise<boolean> {
  const client = new RoveDaemonClient(localDaemonSocketPath(alias, home))
  try {
    await client.request("hello", {})
    return true
  } catch {
    return false
  } finally {
    client.close()
  }
}

/** Serve `alias`'s daemon and PTY sockets here, relayed over ssh. Idempotent; resolves once listening. */
export async function ensureStdioForwards(args: {
  readonly alias: string
  readonly config: MachineConfig
  readonly home?: string
}): Promise<void> {
  mkdirSync(machineSocketDir(args.alias, args.home), { recursive: true })
  const ssh = machineSshArgs(args.alias, args.config, { home: args.home })
  const preamble = args.config.relayPreamble === true
  await serve(localDaemonSocketPath(args.alias, args.home), [...ssh, relayCommand(args.config, false)], preamble)
  await serve(localPtySocketPath(args.alias, args.home), [...ssh, relayCommand(args.config, true)], preamble)
}

/** Stop serving `alias`'s relayed sockets (tunnel stop / machine remove). */
export function stopStdioForwards(alias: string, home?: string): void {
  for (const path of [localDaemonSocketPath(alias, home), localPtySocketPath(alias, home)]) {
    servers.get(path)?.close()
    servers.delete(path)
  }
}
