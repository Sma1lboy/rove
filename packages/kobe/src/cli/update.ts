/**
 * `update` — delegates to the GitHub-hosted `scripts/update.sh` rather than
 * baking the package-manager command into the binary, so install-flow
 * changes need only a script edit on main.
 *
 * Crossing a {@link BREAKING_VERSIONS} entry prints a heads-up; the boot gate
 * in reset-gate.ts enforces `reset`, the script stays dumb.
 */

import { spawnSync } from "node:child_process"
import { updaterShell, updaterShellFailureHint } from "../lib/updater-shell.ts"
import {
  BREAKING_VERSIONS,
  CURRENT_VERSION,
  DEFAULT_RELEASE_CHANNEL,
  RELEASE_CHANNELS,
  type ReleaseChannel,
  UPDATE_COMMAND,
  UPDATE_SCRIPT_URL,
  breakingVersionsCrossed,
  channelOf,
  checkLatestVersion,
  fetchReleaseSummaries,
  recommendedGlobalInstallCommand,
} from "../version.ts"
import { activeCliName } from "./rename-compat.ts"

const CLI_NAME = activeCliName()

export type UpdatePlan = {
  command: string
  args: string[]
  display: string
}

type RunDeps = {
  spawn: typeof spawnSync
  stdout: Pick<typeof process.stdout, "write">
  stderr: Pick<typeof process.stderr, "write">
  exit: (code: number) => never
}

/** `target` (exact version, or channel = npm dist-tag) rides the same `sh -s -- <arg>` slot. */
export function updatePlan(target?: string): UpdatePlan {
  const shell = target === undefined ? UPDATE_COMMAND : `${UPDATE_COMMAND} -s -- ${target}`
  return {
    // Not bare `sh`: Windows has none on PATH. See lib/updater-shell.ts.
    command: updaterShell(),
    args: ["-c", shell],
    display: shell,
  }
}

type ParsedArgs = {
  help: boolean
  dryRun: boolean
  list: boolean
  /** Pinned target version (`kobe update 0.7.90`); undefined = channel head. */
  version?: string
  /** Explicit `--channel`; undefined = stay on this build's channel. */
  channel?: ReleaseChannel
}

const VERSION_SHAPE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function isReleaseChannel(value: string): value is ReleaseChannel {
  return (RELEASE_CHANNELS as readonly string[]).includes(value)
}

export function parseUpdateArgs(args: readonly string[]): ParsedArgs {
  let dryRun = false
  let list = false
  let version: string | undefined
  let channel: ReleaseChannel | undefined

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === undefined) continue
    if (arg === "--help" || arg === "-h" || arg === "help") return { help: true, dryRun, list, version, channel }
    if (arg === "dry-run" || arg === "--dry-run") {
      dryRun = true
      continue
    }
    if (arg === "list" || arg === "--list") {
      list = true
      continue
    }
    // Unknown names are refused: an unpublished dist-tag 404s into a generic
    // script failure that reads like a broken network.
    if (arg === "--channel" || arg.startsWith("--channel=")) {
      const inline = arg.startsWith("--channel=") ? arg.slice("--channel=".length) : undefined
      const value = inline ?? args[++i]
      if (value === undefined || !isReleaseChannel(value)) {
        process.stderr.write(
          `${CLI_NAME} update: --channel expects one of ${RELEASE_CHANNELS.join(", ")}${
            value === undefined ? "" : ` (got "${value}")`
          }\n\n`,
        )
        printUsage(process.stderr)
        process.exit(2)
      }
      channel = value
      continue
    }
    // A bare channel name is the shorthand: `rove update nightly`.
    if (channel === undefined && isReleaseChannel(arg)) {
      channel = arg
      continue
    }
    if (version === undefined && VERSION_SHAPE.test(arg)) {
      version = arg
      continue
    }
    // Error AND usage, so a wrong guess lands on the instructions.
    process.stderr.write(`${CLI_NAME} update: unknown argument "${arg}"\n\n`)
    printUsage(process.stderr)
    process.exit(2)
  }

  return { help: false, dryRun, list, version, channel }
}

function printUsage(out: Pick<typeof process.stderr, "write">): void {
  out.write(
    [
      `Usage: ${CLI_NAME} update [version|channel|list|dry-run]`,
      "",
      "Runs Rove's GitHub-hosted update script. With [version] (e.g.",
      "0.7.90) the script installs that exact release instead of the",
      "head of your channel.",
      "",
      "Verbs (--flag spellings also accepted):",
      "  list      Browse recent versions — a TUI page with release notes",
      "            when interactive, plain text when piped",
      "  dry-run   Print the command without running it",
      "",
      "Flags:",
      "  --channel <name>   Install from this channel instead of yours. The",
      "                     bare name works too: `update nightly`",
      "",
      "Channels:",
      "  latest    Stable releases (default)",
      "  nightly   Automated nightly cut from main — newer, less baked",
      "",
      `You are on: ${channelOf()}`,
      "",
      "Switching channels is just installing from the other one; there is",
      "no stored setting. Update checks follow the build you are running.",
      "",
      "Default command:",
      `  ${UPDATE_COMMAND}`,
      "",
      "Script URL:",
      `  ${UPDATE_SCRIPT_URL}`,
      "",
      "Manual fallback:",
      `  ${recommendedGlobalInstallCommand()}`,
      "",
      "Examples:",
      `  ${CLI_NAME} update`,
      `  ${CLI_NAME} update 0.7.90`,
      `  ${CLI_NAME} update nightly`,
      `  ${CLI_NAME} update --channel latest`,
      `  ${CLI_NAME} update list`,
      `  ${CLI_NAME} update dry-run`,
      "",
    ].join("\n"),
  )
}

/** `--list`: recent GitHub releases, newest first, current marked. */
async function printVersionList(io: RunDeps): Promise<void> {
  const releases = await fetchReleaseSummaries(20)
  if (releases.length === 0) {
    io.stderr.write(`${CLI_NAME} update: could not fetch the release list (offline or rate-limited)\n`)
    io.exit(1)
  }
  for (const release of releases) {
    const markers = [
      release.version === CURRENT_VERSION ? "(current)" : "",
      BREAKING_VERSIONS.includes(release.version) ? `(breaking — needs \`${CLI_NAME} reset\`)` : "",
    ]
      .filter(Boolean)
      .join(" ")
    io.stdout.write(`${release.version}${markers ? `  ${markers}` : ""}\n`)
  }
  io.stdout.write(`\ninstall one with: ${CLI_NAME} update <version>\n`)
}

/**
 * Best-effort heads-up when the move crosses a breaking version. Pinned
 * targets need no network; a channel head resolves via the registry and
 * stays silent when offline — the boot gate is the real enforcement point.
 */
async function warnBreakingCrossings(target: string | undefined, channel: ReleaseChannel, io: RunDeps): Promise<void> {
  // Keeps the common path (and tests) off the network.
  if (BREAKING_VERSIONS.length === 0) return
  const resolved = target ?? (await checkLatestVersion({ force: true, channel }))?.latest
  if (!resolved) return
  const crossed = breakingVersionsCrossed(CURRENT_VERSION, resolved)
  if (crossed.length === 0) return
  io.stderr.write(
    [
      `warning: ${CURRENT_VERSION} -> ${resolved} crosses breaking version(s): ${crossed.join(", ")}.`,
      `After this update, Rove will refuse to start until you run \`${CLI_NAME} reset\``,
      "(worktrees are never touched; add --hard only to also wipe the task index).",
      "",
    ].join("\n"),
  )
}

/**
 * What an install has NOT done: the daemon and the PTY host keep running the
 * old build. The PTY host survives `daemon restart` by design; only `reset`
 * replaces it, ending every live session.
 */
const FOLLOW_UP_NOTE = [
  "",
  `${CLI_NAME}: installed. Two background processes are still running the old build:`,
  `  daemon    → \`${CLI_NAME} daemon restart\` (safe; never touches live sessions)`,
  `  pty host  → only \`${CLI_NAME} reset\` replaces it, and that ends every live`,
  "              terminal and engine session — do it when you can afford to.",
  `Run \`${CLI_NAME} doctor\` to see which of the two is actually stale.`,
  "",
].join("\n")

export async function runUpdateSubcommand(args: readonly string[], deps?: Partial<RunDeps>): Promise<void> {
  const io: RunDeps = {
    spawn: deps?.spawn ?? spawnSync,
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
    exit: deps?.exit ?? ((code) => process.exit(code)),
  }
  const parsed = parseUpdateArgs(args)
  if (parsed.help) {
    printUsage(io.stdout)
    return
  }
  if (parsed.list) {
    // TTY → TUI versions browser; injected deps or a pipe → plain text.
    if (deps === undefined && process.stdout.isTTY) {
      const { startVersionsHost } = await import("../tui-react/component/versions-page.tsx")
      await startVersionsHost()
      return
    }
    await printVersionList(io)
    return
  }

  // Pinned version > explicit --channel > this build's channel.
  const channel = parsed.channel ?? channelOf()
  const target = parsed.version ?? (channel === DEFAULT_RELEASE_CHANNEL ? undefined : channel)
  const plan = updatePlan(target)
  const switching = parsed.channel !== undefined && parsed.channel !== channelOf()
  io.stdout.write(`${CLI_NAME} ${CURRENT_VERSION} -> ${target ?? channel}\n`)
  if (switching) io.stdout.write(`switching channel: ${channelOf()} -> ${channel}\n`)
  io.stdout.write(`running: ${plan.display}\n`)
  // Warn BEFORE the dry-run bail: a rehearsal must show what you'd act on.
  await warnBreakingCrossings(parsed.version, channel, io)
  if (parsed.dryRun) return

  const result = io.spawn(plan.command, plan.args, { stdio: "inherit" })
  if (result.error) {
    io.stderr.write(`${CLI_NAME} update: failed to run ${plan.command}: ${result.error.message}\n`)
    const hint = updaterShellFailureHint()
    if (hint) io.stderr.write(hint)
    io.exit(1)
  }
  if (result.status === 0) io.stdout.write(FOLLOW_UP_NOTE)
  io.exit(result.status ?? 1)
}
