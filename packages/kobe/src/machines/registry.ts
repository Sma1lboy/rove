/**
 * The machine registry: what `rove machine add|remove|list` persists, and the
 * one place that parses an SSH target string.
 *
 * A "machine" is another computer running its own Rove daemon. Rove reaches it
 * by forwarding that daemon's unix socket over SSH — no TCP listener, no
 * auth protocol of Rove's own (`docs/MACHINES.md`). So everything stored here
 * is addressing plus the same `RemoteAuthConfig` shape `remoteRepos` already
 * uses: a key path, or a keychain POINTER. A password never lands in
 * state.json.
 *
 * Distinct from `state/remote-repos.ts`, which registers a remote PROJECT for
 * the experimental `rove add --remote` path — that one assumes the far side
 * has no Rove and drives git over SSH itself. This module assumes the far side
 * runs Rove and speaks the daemon protocol.
 *
 * Imports `store.ts` only (same cycle rule as `remote-repos.ts`).
 */

import type { RemoteAuthConfig } from "../state/remote-repos.ts"
import { type StateSnapshot, loadStateFile, updateStateFile } from "../state/store.ts"

/** The local machine's reserved id. Never registered, never removable. */
export const LOCAL_MACHINE_ID = "local"

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
   * The remote socket paths, as that machine last reported them. Cached so a
   * reconnect does not need a second SSH round-trip before it can forward
   * anything — never derived locally (see `discover.ts`).
   */
  readonly sockets?: { readonly daemon: string; readonly pty: string }
  /** ISO timestamp of registration, for `machine list` ordering. */
  readonly addedAt?: string
}

/**
 * What makes two aliases the SAME machine. All three must match: a hostname
 * alone repeats across cloned VMs, a homeDir alone repeats across every mac,
 * and a pid alone recycles. Together they name one running daemon serving one
 * state root on one host, which is exactly the thing a machine row stands for.
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
 * Parse `[user@]host[:port]` as `rove machine add` accepts it.
 *
 * A bare `host` is the intended shape: it lets ssh_config own the user, the
 * port and the identity file, which is what makes `rove machine add narwhal`
 * work off an existing `Host narwhal` block with nothing else configured.
 * Returns null for an empty or malformed target rather than guessing.
 */
export function parseSshTarget(target: string): { host: string; user?: string; port?: number } | null {
  const trimmed = target.trim()
  if (!trimmed) return null
  const at = trimmed.lastIndexOf("@")
  const user = at >= 0 ? trimmed.slice(0, at) : undefined
  const rest = at >= 0 ? trimmed.slice(at + 1) : trimmed
  if (at >= 0 && !user) return null
  // Port parsing follows ssh's own rule rather than "split on the last colon":
  // an IPv6 literal is colons all the way down, so `::1` would otherwise read
  // as host `:` on port 1 — a silently WRONG target, which is worse than a
  // refusal. So a bare address keeps every colon it has, and an IPv6 address
  // that wants a port must be bracketed, exactly as `ssh [::1]:2222` requires.
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(rest)
  const portMatch = bracketed ? null : /^([^:]*):(\d{1,5})$/.exec(rest)
  const host = bracketed ? (bracketed[1] ?? "") : portMatch ? (portMatch[1] ?? "") : rest
  const rawPort = bracketed ? bracketed[2] : portMatch?.[2]
  const port = rawPort ? Number(rawPort) : undefined
  if (!host || /\s/.test(host)) return null
  if (port !== undefined && (port < 1 || port > 65535)) return null
  return { host, ...(user ? { user } : {}), ...(port ? { port } : {}) }
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
 * One rule, shared by the sidebar and by `rove api list`, because the two
 * disagreeing is exactly the bug it exists to prevent — a machine that renders
 * as one row while the CLI lists its tasks twice. An entry that has never
 * connected has no identity to compare and is always kept: it may turn out to
 * be a machine of its own.
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
 * null. `self` is excluded so re-connecting an alias never reports itself as
 * its own duplicate.
 *
 * Pure over an explicit map so the merge rule is unit-testable without a state
 * file.
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
