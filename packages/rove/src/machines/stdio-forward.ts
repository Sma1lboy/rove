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
import { logClientError } from "@sma1lboy/rove-daemon/client/client-log"
import { roveCommand } from "./discover.ts"
import type { MachineConfig } from "./registry.ts"
import { localDaemonSocketPath, localPtySocketPath, machineSocketDir, machineSshArgs } from "./ssh-args.ts"

/** Hubs that cannot use `ssh -L sock:sock` — or anyone who asks for it. */
export function useStdioTransport(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" || process.env.ROVE_MACHINE_TRANSPORT === "stdio"
}

/** The remote command one relay runs. `roveBin` is the machine's own Rove when discovery found one off PATH. */
export function relayCommand(roveBin: string | undefined, pty: boolean): string {
  // `roveCommand` puts the binary's own dir on PATH: an nvm install's shebang needs its `node`.
  return `${roveCommand(roveBin)} daemon relay${pty ? " --pty" : ""}`
}

const servers = new Map<string, Server>()

function serve(path: string, argv: readonly string[]): Promise<void> {
  if (servers.has(path)) return Promise.resolve()
  const server = createServer((conn) => {
    const [cmd, ...args] = argv
    const child: ChildProcess = spawn(cmd ?? "ssh", args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
    conn.pipe(child.stdin as NodeJS.WritableStream)
    child.stdout?.pipe(conn)
    const end = () => {
      conn.destroy()
      child.kill()
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
    server.listen(path, () => resolve())
  })
}

/** Serve `alias`'s daemon and PTY sockets here, relayed over ssh. Idempotent; resolves once listening. */
export async function ensureStdioForwards(args: {
  readonly alias: string
  readonly config: MachineConfig & { readonly roveBin?: string }
  readonly home?: string
}): Promise<void> {
  mkdirSync(machineSocketDir(args.alias, args.home), { recursive: true })
  const ssh = machineSshArgs(args.alias, args.config, { home: args.home })
  await serve(localDaemonSocketPath(args.alias, args.home), [...ssh, relayCommand(args.config.roveBin, false)])
  await serve(localPtySocketPath(args.alias, args.home), [...ssh, relayCommand(args.config.roveBin, true)])
}

/** Stop serving `alias`'s relayed sockets (tunnel stop / machine remove). */
export function stopStdioForwards(alias: string, home?: string): void {
  for (const path of [localDaemonSocketPath(alias, home), localPtySocketPath(alias, home)]) {
    servers.get(path)?.close()
    servers.delete(path)
  }
}
