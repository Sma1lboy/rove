/**
 * `rove machine <add|remove|list>`. Machines are reached by forwarding the
 * daemon's unix socket over SSH — no ports, no own auth. The remote socket
 * path is always asked, never guessed.
 *
 * `add` VERIFIES before saving: a silently-offline row can't say whether the
 * host, install or daemon is at fault, so a failed probe fails the command
 * with the specific remedy.
 */

import { checkHostKey } from "../machines/host-key.ts"
import { INBOUND_CLASSES, deniedClasses, setInbound } from "../machines/inbound.ts"
import {
  type MachineConfig,
  addMachine,
  defaultMachineAlias,
  duplicateAliasOf,
  getMachine,
  isValidMachineAlias,
  listMachines,
  parseSshTarget,
  removeMachine,
  sanitizeAlias,
  setMachineIdentity,
  sshTargetOf,
  updateMachine,
} from "../machines/registry.ts"
import { readMachines } from "../machines/registry.ts"
import {
  installReverseTunnel,
  reverseTunnelArgv,
  tunnelServicePath,
  uninstallReverseTunnel,
} from "../machines/reverse-tunnel.ts"
import { type SetupRuntime, establishMachine } from "../machines/setup.ts"
import { machineSocketDir } from "../machines/ssh-args.ts"
import { ROVE_PRODUCT_NAME } from "../product.ts"
import { loadStateFile } from "../state/store.ts"
import { CURRENT_VERSION } from "../version.ts"
import { argvHasFlag } from "./argv.ts"
import { defaultFixRuntime } from "./doctor-fix.ts"

const CLI_NAME = ROVE_PRODUCT_NAME

const MACHINE_USAGE = [
  `Usage: ${CLI_NAME} machine <add|remove|list> [options]`,
  "",
  "Manage the other computers running Rove. Each one is reached over SSH;",
  "its tasks appear in the sidebar under a row of its own.",
  "",
  "Commands:",
  "  add <ssh-target>        Register a machine (verifies it, offering fixes, before saving)",
  "  doctor [alias]          Re-check registered machines and offer the same fixes",
  "  remove <alias>          Forget a machine (nothing on it is touched)",
  "  list                    Show registered machines",
  "  tunnel <alias>          Keep a reverse tunnel to <alias> so it can reach THIS machine",
  "  inbound [allow|deny <class>]  What other machines' hubs may run here (default: everything)",
  "",
  "Add options:",
  "  --alias <name>          Local name for the machine (default: the target you typed)",
  "  --port <n>              SSH port (default: whatever ssh_config says)",
  "  --identity <file>       SSH private key (default: ssh-agent / ssh_config)",
  "  --yes                   Run every offered fix without asking (add, doctor)",
  "",
  "Tunnel options (when <alias> cannot reach this machine, e.g. WSL behind Windows NAT):",
  "  --install               Run it as a login service (systemd user unit / launchd agent)",
  "  --uninstall             Stop and remove that service",
  "  --print                 Print the ssh command and service file; change nothing (default)",
  "  --remote-port <n>       Port on <alias>'s loopback that leads back here (default 2222)",
  "  --local-port <n>        This machine's sshd port (default 22)",
  "  Then on <alias>: machine add <you>@127.0.0.1:<remote-port>",
  "",
  "  <ssh-target> is [user@]host[:port] — usually just an ssh_config Host alias.",
  "  In a terminal, a key the machine rejects or a missing Rove is offered as",
  "  a fix (a dedicated hub key, the install script) instead of an error.",
  "",
].join("\n")

function usageError(message: string): never {
  process.stderr.write(`${CLI_NAME} machine: ${message}\n\n${MACHINE_USAGE}\n`)
  process.exit(2)
}

function fail(message: string): never {
  process.stderr.write(`${CLI_NAME} machine: ${message}\n`)
  process.exit(1)
}

/** `--name value` and `--name=value` both. Missing a value is a usage error,
 *  not a silently-absent flag. */
function flagValue(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
    if (arg !== `--${name}`) continue
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("--")) usageError(`--${name} needs a value`)
    return value
  }
  return undefined
}

export async function runMachineSubcommand(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv
  if (!verb || verb === "--help" || verb === "-h" || verb === "help") {
    process.stdout.write(`${MACHINE_USAGE}\n`)
    return
  }
  if (verb === "list") return list()
  if (verb === "add") return await add(rest)
  if (verb === "doctor") return await doctor(rest)
  if (verb === "remove") return remove(rest)
  if (verb === "tunnel") return tunnel(rest)
  if (verb === "inbound") return inbound(rest)
  usageError(`unknown verb "${verb}"`)
}

async function add(argv: readonly string[]): Promise<void> {
  const target = positionalOf(argv)
  if (!target) usageError("add needs an ssh target, e.g. `machine add narwhal`")
  const parsed = parseSshTarget(target)
  if (!parsed) usageError(`"${target}" is not a valid ssh target ([user@]host[:port])`)
  const portFlag = flagValue(argv, "port")
  const port = portFlag ? Number(portFlag) : parsed.port
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) usageError("--port must be 1-65535")
  const identity = flagValue(argv, "identity")

  // The default alias may need the remote hostname, known only after the
  // probe; the provisional alias just names a ControlMaster socket.
  const requested = flagValue(argv, "alias")
  if (requested && !isValidMachineAlias(requested)) {
    usageError(`--alias must be letters/digits/._- and cannot be "local" (got "${requested}")`)
  }
  const probeAlias = requested ?? sanitizeAlias(parsed.host)
  const config: MachineConfig = {
    host: parsed.host,
    ...(parsed.user ? { user: parsed.user } : {}),
    ...(port ? { port } : {}),
    auth: identity ? { kind: "key", keyPath: identity } : { kind: "key" },
  }

  await confirmHostKey(config)
  process.stderr.write(`${CLI_NAME} machine: contacting ${sshTargetOf(config)}…\n`)
  const established = await establishMachine(probeAlias, config, setupRuntime(argv))
  if (!established.ok) fail("nothing was saved")
  const found = established.found
  const settled = established.config

  const alias =
    requested ??
    defaultMachineAlias({
      typedHost: parsed.host,
      typedUser: parsed.user,
      port,
      remoteHostname: found.status.hostname,
    })
  if (!isValidMachineAlias(alias))
    fail(`could not derive a usable alias from "${found.status.hostname}" — pass --alias`)

  const identityTriple = {
    hostname: found.status.hostname,
    homeDir: found.status.homeDir,
    daemonPid: found.status.daemonPid,
  }
  const duplicate = duplicateAliasOf(readMachines(loadStateFile()), alias, identityTriple)

  const sockets = { daemon: found.status.socketPath, pty: found.status.ptySocketPath }
  if (found.roveBin) {
    process.stderr.write(
      `${CLI_NAME} machine: rove is not on ${alias}'s non-interactive PATH; using ${found.roveBin}\n`,
    )
  }
  addMachine(alias, { ...settled, identity: identityTriple, sockets })
  setMachineIdentity(alias, identityTriple)
  // Forward now, or `rove api list` can't see it until a TUI starts one.
  const { ensureForwards } = await import("../machines/tunnel.ts")
  const up = await ensureForwards({
    alias,
    config: settled,
    remoteDaemonSocket: sockets.daemon,
    remotePtySocket: sockets.pty,
  })

  process.stdout.write(
    `${CLI_NAME} machine: ${alias} → ${sshTargetOf(settled)} (rove ${found.status.roveVersion || "?"} on ${found.status.hostname || "?"})\n`,
  )
  if (!up) {
    process.stderr.write(
      `${CLI_NAME} machine: registered, but could not forward ${alias}'s socket yet — it will show as offline until the connection comes up\n`,
    )
  }
  if (duplicate) {
    // Not an error; the sidebar shows one row (`MachineHub.republishTasks`).
    process.stdout.write(
      `${CLI_NAME} machine: ${alias} is the same machine as ${duplicate} (hostname/homeDir/pid match) — the sidebar shows one row\n`,
    )
  }
}

function setupRuntime(argv: readonly string[]): SetupRuntime {
  const yes = argv.includes("--yes")
  const fixRuntime = defaultFixRuntime()
  return {
    confirm: fixRuntime.confirm,
    exec: fixRuntime.exec,
    out: (line) => process.stderr.write(`${line}\n`),
    ask: !yes,
    planOnly: !yes && process.stdin.isTTY !== true,
  }
}

/**
 * Re-check registered machines: reachable, Rove answering, socket forwarded.
 * A machine that drifted (key revoked, Rove uninstalled, moved PATH) gets the
 * same fixes `add` offers, and its registry entry is refreshed.
 */
async function doctor(argv: readonly string[]): Promise<void> {
  const alias = positionalOf(argv)
  const entries = listMachines().filter((m) => !alias || m.alias === alias)
  if (alias && entries.length === 0) fail(`no machine named "${alias}" (see \`${CLI_NAME} machine list\`)`)
  if (entries.length === 0) {
    process.stdout.write(`No machines registered. Add one with \`${CLI_NAME} machine add <ssh-target>\`.\n`)
    return
  }
  const rt = setupRuntime(argv)
  const { ensureForwards } = await import("../machines/tunnel.ts")
  let failed = 0
  for (const { alias: name, ...config } of entries) {
    process.stderr.write(`${CLI_NAME} machine: checking ${name} (${sshTargetOf(config)})…\n`)
    const established = await establishMachine(name, config, rt)
    if (!established.ok) {
      failed++
      process.stdout.write(`${name}  ✗  ${established.failure.code}\n`)
      continue
    }
    const { found, config: settled } = established
    const sockets = { daemon: found.status.socketPath, pty: found.status.ptySocketPath }
    updateMachine(name, { ...settled, sockets })
    const up = await ensureForwards({
      alias: name,
      config: settled,
      remoteDaemonSocket: sockets.daemon,
      remotePtySocket: sockets.pty,
    })
    const version = found.status.roveVersion || "?"
    const skew = version !== CURRENT_VERSION ? ` (this machine runs ${CURRENT_VERSION})` : ""
    process.stdout.write(
      `${name}  ${up ? "✓" : "✗ socket not forwarded"}  rove ${version}${skew} on ${found.status.hostname || "?"}\n`,
    )
    if (!up) failed++
  }
  if (failed > 0) process.exitCode = 1
}

/**
 * Show a never-seen host key's fingerprint before trusting it. A terminal is
 * asked; a script keeps ssh's own trust-on-first-use and gets the fingerprint
 * on stderr, so the log still records what was trusted.
 */
async function confirmHostKey(config: MachineConfig): Promise<void> {
  const check = await checkHostKey(config)
  if (check.state !== "unknown") return
  const write = (line: string): void => {
    process.stderr.write(`${line}\n`)
  }
  write(
    `${CLI_NAME} machine: first connection to ${sshTargetOf(config)} (${check.destination.knownHostsName}). Its host key:`,
  )
  for (const line of check.fingerprints) write(`  ${line}`)
  if (process.stdin.isTTY !== true) {
    write(`${CLI_NAME} machine: not a terminal; trusting it on first use, as ssh would`)
    return
  }
  write("Compare it with the machine's own `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` if you can.")
  if (!(await defaultFixRuntime().confirm("Trust this host key? [y/N] "))) {
    fail("host key not trusted; nothing was saved")
  }
  check.trust()
}

function remove(argv: readonly string[]): void {
  const alias = argv[0]
  if (!alias) usageError("remove needs an alias, e.g. `machine remove narwhal`")
  if (!getMachine(alias)) fail(`no machine named "${alias}" (see \`${CLI_NAME} machine list\`)`)
  removeMachine(alias)
  process.stdout.write(
    `${CLI_NAME} machine: removed ${alias}. Nothing on that machine was changed — its daemon, tasks and worktrees are untouched.\n`,
  )
  process.stdout.write(`${CLI_NAME} machine: leftover sockets live in ${machineSocketDir(alias)}\n`)
}

function tunnel(argv: readonly string[]): void {
  const alias = positionalOf(argv)
  if (!alias) usageError("tunnel needs the alias of the machine to tunnel to, e.g. `machine tunnel mac --install`")
  const entry = getMachine(alias)
  if (!entry) fail(`no machine named "${alias}" (see \`${CLI_NAME} machine list\`)`)
  const port = (name: string, fallback: number) => {
    const raw = flagValue(argv, name)
    if (raw === undefined) return fallback
    const n = Number.parseInt(raw, 10)
    if (!Number.isInteger(n) || n < 1 || n > 65535) usageError(`--${name} must be a port number`)
    return n
  }
  const ports = { remotePort: port("remote-port", 2222), localPort: port("local-port", 22) }
  if (argvHasFlag(argv, "--uninstall")) {
    const removed = uninstallReverseTunnel(alias)
    process.stdout.write(
      removed
        ? `${CLI_NAME} machine: removed the tunnel service ${removed}
`
        : `${CLI_NAME} machine: no tunnel service for ${alias}
`,
    )
    return
  }
  if (!argvHasFlag(argv, "--install")) {
    process.stdout.write(`${reverseTunnelArgv(entry, ports).join(" ")}
`)
    const path = tunnelServicePath(alias)
    process.stdout.write(
      path
        ? `
--install writes ${path} and starts it.
`
        : `
No service manager Rove supports here; keep the command above running yourself.
`,
    )
    return
  }
  try {
    const result = installReverseTunnel(alias, entry, ports)
    process.stdout.write(`${CLI_NAME} machine: wrote ${result.path}
`)
    if (!result.started) fail(`the service did not start: ${result.detail}`)
    process.stdout.write(
      `${CLI_NAME} machine: tunnel to ${alias} is up and restarts on its own. On ${alias}, register this machine with \`${CLI_NAME} machine add <you>@127.0.0.1:${ports.remotePort}\`.
`,
    )
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

/**
 * This machine's policy for verbs another machine's hub forwards here. Classes are the verb groups
 * plus `land` (land, publish). Nothing is denied until you deny it.
 */
function inbound(argv: readonly string[]): void {
  const [action, cls] = argv
  if (action === "allow" || action === "deny") {
    if (!cls || !INBOUND_CLASSES.includes(cls))
      usageError(`inbound ${action} needs one of: ${INBOUND_CLASSES.join(", ")}`)
    const denied = setInbound(cls, action === "allow")
    process.stdout.write(
      `${CLI_NAME} machine: other machines ${action === "allow" ? "may now" : "may no longer"} run "${cls}" verbs here. Denied: ${denied.length ? denied.join(", ") : "nothing"}\n`,
    )
    return
  }
  if (action !== undefined) usageError("inbound takes allow|deny <class>, or nothing to show the policy")
  const denied = new Set(deniedClasses())
  for (const c of INBOUND_CLASSES) process.stdout.write(`${c.padEnd(11)} ${denied.has(c) ? "deny" : "allow"}\n`)
}

function list(): void {
  const machines = listMachines()
  if (machines.length === 0) {
    process.stdout.write(`No machines registered. Add one with \`${CLI_NAME} machine add <ssh-target>\`.\n`)
    return
  }
  const all = readMachines(loadStateFile())
  const rows = machines.map((entry) => {
    const duplicate = entry.identity ? duplicateAliasOf(all, entry.alias, entry.identity) : null
    return [
      entry.alias,
      sshTargetOf(entry),
      entry.identity?.hostname ?? "—",
      duplicate ? `same machine as ${duplicate}` : "",
    ]
  })
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((row) => (row[i] ?? "").length), 0))
  for (const row of rows) {
    const line = [0, 1, 2].map((i) => (row[i] ?? "").padEnd(widths[i] ?? 0)).join("  ")
    process.stdout.write(`${line}${row[3] ? `  ${row[3]}` : ""}\n`.replace(/\s+$/, "\n"))
  }
}

/** Flags that carry no value; every other flag eats the next token. */
const SWITCHES = new Set(["--yes", "--install", "--uninstall", "--print"])

/** The first argument that is neither a `--flag` nor a flag's value. */
function positionalOf(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg.startsWith("--")) {
      // `--flag=value` carries its value; `--flag value` eats the next token.
      if (!arg.includes("=") && !SWITCHES.has(arg)) i++
      continue
    }
    return arg
  }
  return undefined
}
