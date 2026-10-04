/**
 * The machine registry: what `rove machine add|remove|list` persists, and the
 * one place that parses an SSH target string.
 *
 * A "machine" is another computer running its own Rove daemon, reached by
 * forwarding its unix socket over SSH — no TCP listener, no auth protocol of
 * Rove's own (`docs/MACHINES.md`). Stored: addressing plus `RemoteAuthConfig`
 * (a key path or a keychain POINTER). A password never lands in state.json.
 *
 * Unlike `state/remote-repos.ts` (`rove add --remote`, far side has no Rove,
 * git over SSH), this assumes the far side runs Rove and speaks the daemon
 * protocol.
 *
 * Imports `store.ts` only (same cycle rule as `remote-repos.ts`).
 */

import type { RemoteAuthConfig } from "../state/remote-repos.ts"
import { type StateSnapshot, loadStateFile, updateStateFile } from "../state/store.ts"

/** The local machine's reserved id. Never registered, never removable. */
const LOCAL_MACHINE_ID = "local"

export interface MachineConfig {
  /** The SSH host as typed — an ssh_config `Host` alias is the common case,
   *  so this is NOT necessarily a DNS name. */
  readonly host: string
  /** Login user, or "" to let ssh_config decide. */
  readonly user?: string
  readonly port?: number
  readonly auth: RemoteAuthConfig
  /**
   * Identity learned from the remote daemon's `hello` — how two aliases are
   * recognized as one machine. Absent until the first successful connect.
   */
  readonly identity?: MachineIdentity
  /**
   * The remote socket paths as that machine last reported them, cached to skip
   * an SSH round-trip on reconnect. Never derived locally (see `discover.ts`).
   */
  readonly sockets?: { readonly daemon: string; readonly pty: string }
  /** ISO timestamp of registration, for `machine list` ordering. */
  readonly addedAt?: string
}

/**
 * What makes two aliases the SAME machine. All three must match: hostnames
 * repeat across cloned VMs, homeDirs across macs, and pids recycle. Together
 * they name one daemon serving one state root on one host.
 */
export interface MachineIdentity {
  readonly hostname: string
  readonly homeDir: string
  readonly daemonPid: number
}

export type MachineEntry = { readonly alias: string } & MachineConfig

/** Aliases must survive being a path segment (`machines/<alias>/daemon.sock`). */
const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isValidMachineAlias(alias: string): boolean {
  return alias !== LOCAL_MACHINE_ID && alias.length <= 64 && ALIAS_RE.test(alias)
}

/**
 * Parse `[user@]host[:port]` as `rove machine add` accepts it. A bare `host` is
 * the intended shape, letting ssh_config own user, port and identity file.
 * Returns null for an empty or malformed target rather than guessing.
 */
export function parseSshTarget(target: string): { host: string; user?: string; port?: number } | null {
  const trimmed = target.trim()
  if (!trimmed) return null
  const at = trimmed.lastIndexOf("@")
  const user = at >= 0 ? trimmed.slice(0, at) : undefined
  const rest = at >= 0 ? trimmed.slice(at + 1) : trimmed
  if (at >= 0 && !user) return null
  // ssh's rule, not "split on the last colon" (which reads `::1` as host `:`
  // port 1): a bare address keeps every colon; IPv6 with a port must be
  // bracketed, as `ssh [::1]:2222` requires.
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(rest)
  const portMatch = bracketed ? null : /^([^:]*):(\d{1,5})$/.exec(rest)
  const host = bracketed ? (bracketed[1] ?? "") : portMatch ? (portMatch[1] ?? "") : rest
  const rawPort = bracketed ? bracketed[2] : portMatch?.[2]
  const port = rawPort ? Number(rawPort) : undefined
  if (!host || /\s/.test(host)) return null
  if (port !== undefined && (port < 1 || port > 65535)) return null
  return { host, ...(user ? { user } : {}), ...(port ? { port } : {}) }
}

/**
 * What to call a machine when the user did not pass `--alias`.
 *
 * A BARE host (`rove machine add narwhal`) is a name the user chose, usually a
 * short `ssh_config` `Host`; keep it rather than a long hostname that fills the
 * sidebar rail (`Nahuels-Mac-mini.local`).
 *
 * Anything else (`user@host`, explicit port, bare IP) is addressing, so the
 * remote hostname wins — an IP would survive {@link sanitizeAlias} only as its
 * first octet.
 *
 * Pure: `remoteHostname` is passed in, known only after the probe.
 */
export function defaultMachineAlias(args: {
  readonly typedHost: string
  readonly typedUser?: string
  readonly port?: number
  readonly remoteHostname?: string
}): string {
  const bare = !args.typedUser && args.port === undefined && !isIpLiteral(args.typedHost)
  const source = bare ? args.typedHost : args.remoteHostname || args.typedHost
  return sanitizeAlias(source)
}

/** An IPv4 dotted quad or an IPv6 literal — addressing, never a chosen name. */
function isIpLiteral(host: string): boolean {
  return host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

/**
 * A host or alias as a filesystem-safe alias: the leading label only
 * (`Nahuels-Mac-mini.local` → `Nahuels-Mac-mini`), with anything outside
 * `[A-Za-z0-9._-]` collapsed to `-`. The result names a directory under
 * `<home>/.rove/machines/`, so it has to survive being a path segment.
 */
export function sanitizeAlias(raw: string): string {
  const base = raw.split(".")[0] ?? raw
  return base.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64)
}

/** `user@host` (or bare `host`) — what goes on the ssh command line. */
export function sshTargetOf(config: MachineConfig): string {
  return config.user ? `${config.user}@${config.host}` : config.host
}

export function readMachines(state: StateSnapshot): Record<string, MachineConfig> {
  const raw = state.machines
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, MachineConfig>
}

/** Every registered machine, in stored order. Never includes `local`. */
export function listMachines(): MachineEntry[] {
  const machines = readMachines(loadStateFile())
  return Object.entries(machines).map(([alias, config]) => ({ alias, ...config }))
}

export function getMachine(alias: string): MachineConfig | null {
  return readMachines(loadStateFile())[alias] ?? null
}

/**
 * Register (or update) a machine. Overwrites an existing alias, which is how
 * `machine add` doubles as "change the port / the identity file".
 */
export function addMachine(alias: string, config: MachineConfig): { added: boolean } {
  let added = false
  updateStateFile((state) => {
    const machines = { ...readMachines(state) }
    added = machines[alias] === undefined
    machines[alias] = { ...config, addedAt: config.addedAt ?? machines[alias]?.addedAt ?? new Date().toISOString() }
    state.machines = machines
    return undefined
  })
  return { added }
}

/** Record what a successful handshake or probe taught us about a machine. */
export function updateMachine(alias: string, patch: Partial<MachineConfig>): void {
  updateStateFile((state) => {
    const machines = { ...readMachines(state) }
    const existing = machines[alias]
    if (!existing) return false
    machines[alias] = { ...existing, ...patch }
    state.machines = machines
    return undefined
  })
}

/** Record the identity learned from a successful `hello`. */
export function setMachineIdentity(alias: string, identity: MachineIdentity): void {
  updateMachine(alias, { identity })
}

export function removeMachine(alias: string): boolean {
  let removed = false
  updateStateFile((state) => {
    const machines = { ...readMachines(state) }
    removed = machines[alias] !== undefined
    if (!removed) return false
    delete machines[alias]
    state.machines = machines
    return undefined
  })
  return removed
}

/**
 * Registered machines with the duplicates dropped: when two aliases name one
 * machine, the FIRST in stored order survives.
 *
 * Shared by the sidebar and `rove api list` so they never disagree (one row vs
 * tasks listed twice). A never-connected entry has no identity and is always kept.
 */
export function dedupeMachines(entries: readonly MachineEntry[]): MachineEntry[] {
  const kept: MachineEntry[] = []
  const seen: MachineIdentity[] = []
  for (const entry of entries) {
    const identity = entry.identity
    if (identity) {
      if (seen.some((other) => sameMachine(other, identity))) continue
      seen.push(identity)
    }
    kept.push(entry)
  }
  return kept
}

/** All three parts must agree — see {@link duplicateAliasOf}. */
function sameMachine(a: MachineIdentity, b: MachineIdentity): boolean {
  return a.hostname === b.hostname && a.homeDir === b.homeDir && a.daemonPid === b.daemonPid
}

/**
 * The already-registered alias that names the SAME machine as `identity`, or
 * null. `self` is excluded so an alias is never its own duplicate. Pure over an
 * explicit map for unit tests.
 */
export function duplicateAliasOf(
  machines: Readonly<Record<string, MachineConfig>>,
  self: string,
  identity: MachineIdentity,
): string | null {
  for (const [alias, config] of Object.entries(machines)) {
    if (alias === self) continue
    const other = config.identity
    if (!other) continue
    if (
      other.hostname === identity.hostname &&
      other.homeDir === identity.homeDir &&
      other.daemonPid === identity.daemonPid
    ) {
      return alias
    }
  }
  return null
}
