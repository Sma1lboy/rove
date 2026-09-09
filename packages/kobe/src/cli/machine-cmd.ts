/**
 * `rove machine <add|remove|list>` — register the other computers running Rove.
 *
 * A machine is reached by forwarding its daemon's unix socket over SSH; nothing
 * here opens a port and nothing here invents an auth scheme. That means `add`
 * has exactly two jobs: remember how to `ssh` there, and ask that machine where
 * its daemon listens (`machines/discover.ts` — Rove never guesses a remote
 * socket path).
 *
 * `add` VERIFIES before it saves. A registration that silently fails at first
 * connect is worse than a refusal: the machine sits in the sidebar as an
 * offline row and nothing says whether the host, the install or the daemon is
 * the problem. So the discovery probe runs first and its failure is the
 * command's failure, with the specific remedy in the message.
 */

import { discoverMachine } from "../machines/discover.ts"
import {
  type MachineConfig,
  addMachine,
  duplicateAliasOf,
  getMachine,
  isValidMachineAlias,
  listMachines,
  parseSshTarget,
  removeMachine,
  setMachineIdentity,
  sshTargetOf,
} from "../machines/registry.ts"
import { readMachines } from "../machines/registry.ts"
import { machineSocketDir } from "../machines/ssh-args.ts"
import { loadStateFile } from "../state/store.ts"
import { activeCliName } from "./rename-compat.ts"

const CLI_NAME = activeCliName()

const MACHINE_USAGE = [
  `Usage: ${CLI_NAME} machine <add|remove|list> [options]`,
  "",
  "Manage the other computers running Rove. Each one is reached over SSH;",
  "its tasks appear in the sidebar under a row of its own.",
  "",
  "Commands:",
  "  add <ssh-target>        Register a machine (verifies it before saving)",
  "  remove <alias>          Forget a machine (nothing on it is touched)",
  "  list                    Show registered machines",
  "",
  "Add options:",
  "  --alias <name>          Local name for the machine (default: its hostname)",
  "  --port <n>              SSH port (default: whatever ssh_config says)",
  "  --identity <file>       SSH private key (default: ssh-agent / ssh_config)",
  "",
  "  <ssh-target> is [user@]host[:port] — usually just an ssh_config Host alias.",
  "  The machine must already have Rove installed (`npm i -g @sma1lboy/rove`).",
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
  if (verb === "remove") return remove(rest)
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

  // The alias defaults to the machine's own hostname, which is only knowable
  // AFTER the probe — so probe under a provisional alias (the target text),
  // then rename. The provisional alias only names a ControlMaster socket.
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

  process.stderr.write(`${CLI_NAME} machine: contacting ${sshTargetOf(config)}…\n`)
  const found = await discoverMachine(probeAlias, config)
  if (!found.ok) fail(found.message)

  const alias = requested ?? sanitizeAlias(found.status.hostname || parsed.host)
  if (!isValidMachineAlias(alias))
    fail(`could not derive a usable alias from "${found.status.hostname}" — pass --alias`)

  const identityTriple = {
    hostname: found.status.hostname,
    homeDir: found.status.homeDir,
    daemonPid: found.status.daemonPid,
  }
  const duplicate = duplicateAliasOf(readMachines(loadStateFile()), alias, identityTriple)

  addMachine(alias, { ...config, identity: identityTriple })
  setMachineIdentity(alias, identityTriple)

  process.stdout.write(
    `${CLI_NAME} machine: ${alias} → ${sshTargetOf(config)} (rove ${found.status.kobeVersion || "?"} on ${found.status.hostname || "?"})\n`,
  )
  if (duplicate) {
    // Not an error: two names for one machine is a reasonable thing to do by
    // accident, and the fix (pick one) is the user's. The sidebar renders one
    // row either way — see `MachineHub.republishTasks`.
    process.stdout.write(
      `${CLI_NAME} machine: ${alias} is the same machine as ${duplicate} (hostname/homeDir/pid match) — the sidebar shows one row\n`,
    )
  }
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

/** The first argument that is neither a `--flag` nor a flag's value. Every
 *  flag this command takes carries one, so skipping in pairs is exact. */
function positionalOf(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg.startsWith("--")) {
      // `--flag=value` carries its value; `--flag value` eats the next token.
      if (!arg.includes("=")) i++
      continue
    }
    return arg
  }
  return undefined
}

/** An ssh target or hostname as a filesystem-safe alias: `Nahuels-Mac-mini.local`
 *  keeps its dots and dashes, anything else collapses to `-`. */
function sanitizeAlias(raw: string): string {
  const base = raw.split(".")[0] ?? raw
  return base.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64)
}
