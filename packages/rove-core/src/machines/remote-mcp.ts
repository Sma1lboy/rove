/**
 * MCP servers of the machine a remote workspace lives on (`rove machine mcp`), brought into a session
 * here: each one's loopback port there is forwarded (`ssh -O forward -L`) over the machine's shared
 * ControlMaster to a port on this machine's loopback, so a browser server there opens that machine's
 * `localhost` and its screenshots come back as MCP images.
 *
 * A master exits once idle (ControlPersist) and takes its forwards with it, so the forward is ensured
 * at launch and again before each call to the server (the engine's pre-tool hook).
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { type MachineMcp, getMachine } from "@sma1lboy/rove-core/machines/registry.ts"
import { machineSshArgs } from "@sma1lboy/rove-core/machines/ssh-args.ts"

export interface ForwardedMcp {
  /** The server's name in the session: `<name>-<machine>`, so it never reads as this machine's own. */
  readonly server: string
  /** Its URL on this machine, through the forward. */
  readonly url: string
  /** The `[host]:port` it listens on there. */
  readonly target: { readonly host: string; readonly port: number }
  /** The local port the forward listens on. */
  readonly port: number
}

/** `chrome` on `win` → `chrome-win`; only what a tool name allows. */
export function forwardedServerName(name: string, machine: string): string {
  return `${name}-${machine}`.replace(/[^A-Za-z0-9_-]/g, "_")
}

/**
 * Where a server's forward listens here: the same port for every session on that machine, so one
 * forward serves them all and adding it twice is a no-op.
 * ponytail: a hash into 20000-59999; a port another program holds fails the forward, `rove machine mcp` names it.
 */
export function forwardPort(machine: string, host: string, port: number): number {
  const digest = createHash("sha256").update(`${machine}\0${host}:${port}`).digest()
  return 20_000 + (digest.readUInt32BE(0) % 40_000)
}

/** The forwards a machine's MCP servers get; a URL that is not http(s) is skipped. */
export function forwardedMcp(machine: string, servers: readonly MachineMcp[]): ForwardedMcp[] {
  return servers.flatMap((entry) => {
    let url: URL
    try {
      url = new URL(entry.url)
    } catch {
      return []
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return []
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80)
    const host = url.hostname
    const local = forwardPort(machine, host, port)
    const here = new URL(url)
    here.hostname = "127.0.0.1"
    here.port = String(local)
    return [
      { server: forwardedServerName(entry.name, machine), url: here.toString(), target: { host, port }, port: local },
    ]
  })
}

/** A machine's registered servers with their forwards; [] for an unknown machine or none set. */
export function machineMcp(machine: string): ForwardedMcp[] {
  return forwardedMcp(machine, getMachine(machine)?.mcp ?? [])
}

/**
 * Make sure each forward is up: the master first (a session that sat idle outlived it), then the
 * forwards on it. Synchronous, since an engine's argv is built synchronously; each step is a
 * round-trip over a live master. Returns the forwards that failed.
 */
export function ensureMcpForwards(machine: string, forwards: readonly ForwardedMcp[]): ForwardedMcp[] {
  const config = getMachine(machine)
  if (!config || forwards.length === 0) return config ? [] : [...forwards]
  const base = machineSshArgs(machine, config)
  const flags = base.slice(1, -1)
  const target = base.at(-1) ?? machine
  const ssh = (args: readonly string[], timeout: number) =>
    spawnSync(base[0] ?? "ssh", [...flags, ...args, target], { stdio: "ignore", timeout }).status === 0
  // A plain session opens the master (ControlMaster=auto); `exit` is a command in sh, cmd and PowerShell alike.
  const master =
    ssh(["-O", "check"], 5_000) ||
    spawnSync(base[0] ?? "ssh", [...base.slice(1), "exit"], { stdio: "ignore", timeout: 30_000 }).status === 0
  if (!master) return [...forwards]
  return forwards.filter(
    (fwd) => !ssh(["-O", "forward", "-L", `127.0.0.1:${fwd.port}:${fwd.target.host}:${fwd.target.port}`], 10_000),
  )
}
